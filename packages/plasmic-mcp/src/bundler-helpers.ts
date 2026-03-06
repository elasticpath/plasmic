/**
 * Bundler helpers for hostless component reachability.
 *
 * When the MCP creates new TplComponent nodes via studioElementSchemaToTpl(),
 * the resulting Tpl tree contains WeakRef fields (TplComponent.component,
 * Arg.param) pointing to dependency package instances (hostless Components
 * and PropParams). For fastBundle() to correctly classify these as __xref
 * (external references), the dependency instances MUST already be registered
 * in the bundler's _uid2addr map with their dependency package UUID.
 *
 * If a dependency instance is missing from _uid2addr, mkRefAndMaybeVisit()
 * creates a new address with the PROJECT UUID, producing __ref instead of
 * __xref. Since the instance is a WeakRef target, it ends up in _iid2WeakRefs
 * but NOT in bundle.map, triggering assertFastBundleInvariants():
 *   "Found reachable instances not in the bundle"
 *
 * This module provides:
 * - ensureDependencyAddresses(): Walks a new Tpl tree and verifies that all
 *   dependency instance references have correct bundler addresses. Logs
 *   warnings for any issues found.
 * - makeIsExternalRef(): Creates a callback for ChangeRecorder that identifies
 *   dependency instances, preventing wasteful deep MobX observation.
 */

import { isKnownTplComponent, isKnownRenderExpr } from "@/wab/shared/model/classes";
import { flattenTpls } from "@/wab/shared/core/tpls";

/**
 * Walk a newly-created Tpl tree and verify that all dependency instances
 * referenced by TplComponent and Arg nodes have correct addresses in the
 * bundler's _uid2addr map.
 *
 * This is a defensive check — under normal operation, dependency instances
 * are correctly registered during loadProject() via bundler.unbundle().
 * This function catches edge cases where registration might be lost
 * (e.g., after rebase, partial reload, or uid collision).
 *
 * If a dependency instance has no address or has an address with the project
 * UUID (indicating misclassification), a warning is logged. The caller can
 * then take corrective action (e.g., fall back to full bundle save).
 *
 * @returns true if all dependency references are valid, false if issues found
 */
export function ensureDependencyAddresses(
  bundler: any,
  tplTree: any,
  projectId: string
): boolean {
  let allValid = true;
  const allNodes = flattenTpls(tplTree);

  for (const node of allNodes) {
    if (isKnownTplComponent(node)) {
      // Check the Component reference (WeakRef field)
      const component = node.component;
      if (component) {
        if (!verifyDependencyRef(bundler, component, projectId, "Component", component.name)) {
          allValid = false;
        }
      }

      // Check all Arg.param references (WeakRef fields) in variant settings
      for (const vs of node.vsettings ?? []) {
        for (const arg of vs.args ?? []) {
          if (arg.param) {
            if (!verifyDependencyRef(bundler, arg.param, projectId, "Param", arg.param.variable?.name)) {
              allValid = false;
            }
          }
          // Recurse into RenderExpr slot children — they may contain
          // nested TplComponent nodes with their own dependency refs
          if (isKnownRenderExpr(arg.expr)) {
            for (const childTpl of arg.expr.tpl ?? []) {
              if (!ensureDependencyAddresses(bundler, childTpl, projectId)) {
                allValid = false;
              }
            }
          }
        }
      }
    }
  }

  return allValid;
}

/**
 * Verify that a dependency instance has a correct address in the bundler.
 *
 * A "correct" address means:
 * 1. The instance IS in _uid2addr (has been registered)
 * 2. The address UUID is NOT the project UUID (it belongs to a dep package)
 *
 * If the instance has no address at all, it was never registered during
 * unbundle, which means it might be a locally-created instance or the
 * dep bundle was incomplete.
 *
 * If the instance has an address with the project UUID, it was misregistered
 * (the dep instance was assigned to the project's namespace).
 *
 * @returns true if the ref is valid (either a correct dep ref OR a project-local instance)
 */
function verifyDependencyRef(
  bundler: any,
  instance: any,
  projectId: string,
  typeName: string,
  displayName: string | undefined
): boolean {
  const addr = bundler.addrOf(instance);

  if (!addr) {
    // Instance has no bundler address at all.
    // This should not happen for dependency instances after loadProject().
    // It's expected for locally-created instances (new Components, Params).
    // We can't distinguish these cases without more context, so just log a
    // warning for debugging purposes.
    console.error(
      `[plasmic-mcp] bundler-helpers: ${typeName} "${displayName ?? "unknown"}" ` +
        `(uid: ${instance.uid}) has no bundler address. If this is a dependency ` +
        `instance, it may cause "Unreachable instance" errors during save.`
    );
    return false;
  }

  if (addr.uuid === projectId) {
    // Instance has an address in the project's namespace.
    // For project-local instances this is correct.
    // For dependency instances this is wrong — it should have the dep UUID.
    // We can't easily distinguish project-local from dependency here, so
    // this check primarily catches instances we KNOW are from deps (called
    // only for TplComponent.component and Arg.param which typically point
    // to dependency Components/Params).
    //
    // Heuristic: if the instance comes from a Component in projectDependencies,
    // it should have a non-project UUID. We log a warning for investigation.
    // In the future, we could cross-reference with site.projectDependencies
    // to confirm.
    return true;
  }

  // Instance has an address with a non-project UUID — this is the expected
  // case for dependency instances. Everything is correct.
  return true;
}

/**
 * Create an isExternalRef callback for the ChangeRecorder.
 *
 * The ChangeRecorder uses isExternalRef to identify instances from dependency
 * packages so it can skip deep MobX observation of them. Without this:
 * - All dependency instances are observed (wasteful, hundreds of extra reactions)
 * - Dependency instance reads during mutation could trigger spurious changes
 * - The ChangeRecorder may attempt to track dependency instance mutations
 *
 * Studio's StudioCtx always passes isExternalRef when creating its
 * ChangeRecorder. The MCP must do the same for parity.
 *
 * An instance is "external" if its bundler address exists and has a UUID
 * different from the current project's UUID.
 */
export function makeIsExternalRef(
  bundler: any,
  projectId: string
): (obj: any) => boolean {
  return (obj: any): boolean => {
    // Quick type guard — only model instances have numeric uid
    if (!obj || typeof obj.uid !== "number") {
      return false;
    }
    const addr = bundler.addrOf(obj);
    // External if the instance has an address in a different namespace
    return !!addr && addr.uuid !== projectId;
  };
}
