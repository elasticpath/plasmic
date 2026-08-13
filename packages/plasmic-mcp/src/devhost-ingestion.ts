/**
 * Ingestion orchestrator — drives Studio's shared `syncCodeComponents`
 * against a fake registry built from the dev host's `/api/plasmic-registry`
 * snapshot. Closes MCP gap #73: new dev-host code components become
 * available in `site.components` without a manual Studio trip.
 *
 * Contract:
 *   given a live `site` and a `FullRegistryData` snapshot,
 *     - new registrations get added via Studio's ingestion path,
 *     - registrations absent from the snapshot are preserved in-place
 *       (Studio's `fixMissingCodeComponents` — non-destructive),
 *     - validation anomalies surface as `warnings` on the result,
 *     - structural corruption (duplicate names, malformed meta) returns
 *       a `fatalError` and the site is left untouched.
 *
 * Wiring mirrors the server-side hostless pattern at
 * `platform/wab/src/wab/server/code-components/code-components.ts:311-326`.
 */

import type { Result } from "neverthrow";
import {
  CodeComponentsRegistry,
  syncCodeComponents,
} from "@/wab/shared/code-components/code-components";
import { TplMgr } from "@/wab/shared/TplMgr";
import {
  mergeRecordedChanges,
  type RecordedChanges,
} from "@/wab/shared/core/observable-model";

// Plasmic's `getBuiltinComponentRegistrations` pulls from @plasmicapp/react-web
// (PlasmicHead, Fetcher). In a server/MCP context those dists may be absent
// or stubbed, which would hand `CodeComponentsRegistry` a `{meta: undefined}`
// entry that crashes `uniqBy(..., cc => cc.meta.name)`. We don't need the
// built-ins for ingestion — we're only reconciling the dev host's
// registrations against `site.components`. Pass an empty bag.
const NO_BUILTINS = {} as any;
import type { FullRegistryData } from "./devhost-sync.js";
import { createFakeDevHostWindow } from "./devhost-sync-shim.js";
import {
  createIngestionCallbacks,
  type IngestionResult as CallbackIngestionResult,
} from "./ingestion-callbacks.js";
import type { ChangeTracker } from "./change-tracker.js";

export interface IngestionResult extends CallbackIngestionResult {
  fatalError?: { code: string; message: string };
  /**
   * Merged `RecordedChanges` from all internal `ctx.change()` passes during
   * `syncCodeComponents`. Non-empty when tracker was provided and the sync
   * actually mutated the site. Pass to `SaveManager.saveChanges()` to
   * persist+broadcast via the normal incremental save path (which emits
   * socket updates to connected Studio clients).
   */
  recordedChanges?: RecordedChanges;
}

export async function ingestDevHostComponents(
  site: any,
  registry: FullRegistryData,
  opts?: { tracker?: ChangeTracker }
): Promise<IngestionResult> {
  const { callbacks, getResult } = createIngestionCallbacks();

  // Build a registry snapshot that unions the incoming dev-host registrations
  // with "shadow" entries for any site component the incoming registry doesn't
  // cover. Without this, Plasmic's own downstream passes
  // (`fixMissingDefaultComponents`, `refreshDefaultSlotContents`) throw
  // `NullOrUndefinedValueError` because they assume every site component has
  // a registry entry. Shadows preserve current metadata in-place and surface
  // the "no longer on the dev host" state via `onMissingCodeComponents`
  // warnings — non-destructive per PRD Q3.
  // Cover-set: site components whose name appears under registry.components OR
  // registry.contexts should NOT be shadowed. A context code-component in the
  // site (e.g. `plasmic-commerce-elastic-path-provider$dev`) is registered on
  // the dev host as a context, not a component. Shadowing it under components
  // would collide with its real context entry and trigger
  // `DuplicateCodeComponentError`.
  const coveredNames = new Set<string>([
    ...(registry.components ?? []).map((c: any) => c.name),
    ...(registry.contexts ?? []).map((c: any) => c.name),
  ]);

  const missingCodeComponents: any[] = [];
  const missingContextComponents: any[] = [];
  for (const c of site.components ?? []) {
    if (!c.codeComponentMeta) continue;
    if (coveredNames.has(c.name)) continue;
    if (c.codeComponentMeta.isContext) {
      missingContextComponents.push(c);
    } else {
      missingCodeComponents.push(c);
    }
  }

  // Build a shadow meta for a site component. Forces `name` + the top-level
  // required fields Studio's `typeCheckRegistrations` insists on (name,
  // importPath, props) — the persisted codeComponentMeta may not have them.
  const toShadow = (c: any) => {
    const base = {
      importPath: c.codeComponentMeta?.importPath ?? c.name,
      importName: c.codeComponentMeta?.importName ?? c.name,
      displayName: c.codeComponentMeta?.displayName ?? c.name,
      props: c.codeComponentMeta?.props ?? {},
    };
    // Spread base → spread codeComponentMeta → force `name` last so it
    // wins even if codeComponentMeta has an undefined `name` field.
    return { ...base, ...c.codeComponentMeta, name: c.name };
  };

  const fakeWindow = createFakeDevHostWindow({
    ...registry,
    components: [
      ...registry.components,
      ...missingCodeComponents.map(toShadow),
    ],
    contexts: [
      ...registry.contexts,
      ...missingContextComponents.map(toShadow),
    ],
  });

  // All shadowed (either kind) are reported as "no longer on dev host"
  // — so the user knows the project is carrying unresolved references.
  const shadowCodeComponents = [
    ...missingCodeComponents,
    ...missingContextComponents,
  ];

  const beforeNames = new Set<string>(
    (site.components ?? []).map((c: any) => c.name)
  );

  const tplMgr = new TplMgr({ site });

  // Every internal `ctx.change(...)` call during syncCodeComponents must
  // run inside the shared ChangeRecorder so the FastBundler tracks new
  // Component / Param / State instances and the SaveManager can broadcast
  // them to Studio via the normal incremental-save / socket path.
  // Accumulate changes across all calls so the caller can save+broadcast
  // atomically.
  const recordedChangesList: RecordedChanges[] = [];
  const ctxChange = opts?.tracker
    ? async (f: () => Result<void, unknown>) => {
        const tracker = opts.tracker!;
        let result: Result<void, unknown>;
        const recorded = tracker.withRecording(() => {
          result = f();
        });
        if (recorded.changes.length > 0 || recorded.removedInsts.length > 0) {
          recordedChangesList.push(recorded);
        }
        return result!;
      }
    : // No tracker (test path / no-op context): run the mutation without
      // recording. Incremental save + live sync don't apply in this mode.
      async (f: () => Result<void, unknown>) => f();

  const ctx: any = {
    site,
    codeComponentsRegistry: new CodeComponentsRegistry(
      fakeWindow as any,
      NO_BUILTINS
    ),
    change: ctxChange,
    observeComponents: () => true,
    getPlumeSite: () => undefined,
    getRootSubReact: () => ({ version: "18.0.0" } as any),
    tplMgr: () => tplMgr,
  };

  // Reset before sync (Studio's server pattern does this too — see
  // server/code-components/code-components.ts:309).
  callbacks.onReset?.();

  const syncResult = await syncCodeComponents(ctx, callbacks as any, {
    force: false,
  });

  // Surface "no longer on the dev host" as warnings on the result. We do
  // this AFTER the sync (post-onReset so the warnings survive) and directly
  // rather than via onMissingCodeComponents (those components are shadowed
  // in the registry so Plasmic doesn't see them as missing — the callback
  // wouldn't fire). Non-destructive per PRD Q3.
  const result = getResult();
  for (const c of shadowCodeComponents) {
    result.warnings.push({
      code: "missing-component",
      componentName: c.name,
      message: `Code component "${c.name}" is referenced by the project but no longer registered on the dev host. Preserved in site.`,
    });
  }

  const syncOutcome = syncResult as Result<void, any> | undefined;
  if (syncOutcome?.isErr()) {
    const err = syncOutcome.error;
    return {
      ...result,
      fatalError: {
        code: err?.name ?? "SyncError",
        message: err?.message ?? String(err),
      },
    };
  }

  const afterNames = new Set<string>(
    (site.components ?? []).map((c: any) => c.name)
  );

  const added: string[] = [];
  const removed: string[] = [];
  for (const n of afterNames) if (!beforeNames.has(n)) added.push(n);
  for (const n of beforeNames) if (!afterNames.has(n)) removed.push(n);

  result.addedComponents = added;
  result.removedComponents = removed;

  const fullResult: IngestionResult = result as IngestionResult;
  if (recordedChangesList.length > 0) {
    fullResult.recordedChanges =
      recordedChangesList.length === 1
        ? recordedChangesList[0]
        : (mergeRecordedChanges as any)(...recordedChangesList);
  }

  return fullResult;
}
