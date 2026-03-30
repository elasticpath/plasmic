/**
 * Post-change fixup pipeline for model mutations.
 *
 * Mirrors Studio's fixupForChanges() (fixes-post-change.ts:69) but only
 * includes the model-affecting fixups — view-related fixups that require
 * StudioCtx (fixupChrome, fixupFocusedFrameIfRemoved, fixupForPlume) are
 * skipped.
 *
 * Critical: fixupComponentUpdatedAt stamps component.updatedAt = Date.now().
 * Without this, the merge algorithm's inferUpdatedComponents() (merge-components.ts:2084)
 * excludes the component from merges entirely — causing silently lost changes.
 *
 * Reference: platform/wab/src/wab/client/fixes-post-change.ts
 */

import { summarizeChanges, type ChangeSummary } from "@/wab/shared/model/model-change-util";
import { mergeRecordedChanges, type RecordedChanges } from "@/wab/shared/core/observable-model";
import { TplMgr } from "@/wab/shared/TplMgr";
import { $$$ } from "@/wab/shared/TplQuery";
import {
  flattenTpls,
  isTplTag,
  isTplSlot,
  isTplComponent,
  isTplContainer,
  isTplTagOrComponent,
  isTplVariantable,
  isGrid,
  getTplOwnerComponent,
  tryGetOwnerSite,
  buildParamToComponent,
} from "@/wab/shared/core/tpls";
import { isTplAttachedToSite } from "@/wab/shared/core/sites";
import {
  ensureCorrectImplicitStates,
  removeImplicitStatesAfterRemovingTplNode,
} from "@/wab/shared/core/states";
import { adjustAllGridChildren, removeAllGridChildProps } from "@/wab/shared/Grids";
import {
  fillVirtualSlotContents,
  findParentArgs,
  findParentSlot,
  isDefaultSlotArg,
} from "@/wab/shared/SlotUtils";
import { isTagListContainer } from "@/wab/shared/core/rich-text-util";
import { isCodeComponent, isPageComponent } from "@/wab/shared/core/components";
import {
  isKnownSlotParam,
  isKnownTplSlot,
  isKnownTplComponent,
  isKnownVirtualRenderExpr,
  RenderExpr,
} from "@/wab/shared/model/classes";
import { isBaseVariant } from "@/wab/shared/Variants";
import { RSH } from "@/wab/shared/RuleSetHelpers";
import { getAllSiteFrames } from "@/wab/shared/core/sites";
import { notNil } from "@/wab/shared/common";

// Re-export for testing
export type { ChangeSummary };

/**
 * Apply all model-affecting fixups after a mutation, mirroring Studio's
 * fixupForChanges() pipeline. Must be called BEFORE saving so that fixup
 * mutations are included in the incremental bundle.
 *
 * @param site  The live Site model
 * @param changes  RecordedChanges from withRecording()
 * @param recorder  The ChangeRecorder (IChangeRecorder) to capture fixup mutations
 * @returns  Merged RecordedChanges (original + fixup mutations)
 */
export function applyFixups(
  site: any,
  changes: RecordedChanges,
  recorder: any
): RecordedChanges {
  // Skip if there are no changes
  if (changes.changes.length === 0 && changes.newInsts.length === 0) {
    return changes;
  }

  // Build a StudioCtx-shaped object for summarizeChanges.
  // The function only accesses .site and .tplMgr() — verified via
  // grep of all studioCtx. usages in model-change-util.ts.
  const tplMgr = new TplMgr({ site });
  const ctx = { site, tplMgr: () => tplMgr } as any;

  let summary: ChangeSummary | undefined;
  try {
    summary = summarizeChanges(ctx, changes);
  } catch (err) {
    // If summarizeChanges fails (e.g., due to a model inconsistency),
    // still apply the critical updatedAt fixup manually and continue.
    console.error(
      `[plasmic-mcp] Fixup: summarizeChanges failed, applying updatedAt only: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return applyUpdatedAtOnly(site, changes, recorder);
  }

  // Guard: if summarizeChanges returned undefined (e.g., mock environment),
  // fall back to stamping all components.
  if (!summary || !summary.newTrees) {
    return applyUpdatedAtOnly(site, changes, recorder);
  }

  const applyFix = (f: () => void): void => {
    const fixChanges = recorder.withRecording(f);
    if (fixChanges && fixChanges.changes) {
      changes = mergeRecordedChanges(changes, fixChanges);
      // Re-summarize after each fixup so subsequent fixups see the updated state
      try {
        summary = summarizeChanges(ctx, changes);
      } catch {
        // If re-summarize fails, continue with existing summary
      }
    }
  };

  // Model-related fixups (same order as Studio)
  if (changes.changes.length > 0) {
    applyFix(() => fixupVirtualSlotArgs(tplMgr, summary));
    applyFix(() => fixupGridChildren(summary));
    applyFix(() => {
      fixupBaseVariantSettings(tplMgr, summary);
      fixupFrameViewModeByRootSize(site);
    });
    applyFix(() => fixupTextTags(summary));
    applyFix(() => {
      fixupIncorrectlyNamedNodes(tplMgr, summary);
      fixupImplicitStates(summary);
    });
    applyFix(() => fixupSlotParamsOrder(summary));
  }

  // Always stamp updatedAt (runs even for CSS-only changes)
  applyFix(() => fixupComponentUpdatedAt(summary));

  return changes;
}

/**
 * Fallback: stamp updatedAt when full summarizeChanges fails.
 * Derives the modified component from RecordedChanges directly.
 */
function applyUpdatedAtOnly(
  site: any,
  changes: RecordedChanges,
  recorder: any
): RecordedChanges {
  const fixChanges = recorder.withRecording(() => {
    // Stamp all components since we can't determine which ones changed
    for (const component of site.components ?? []) {
      component.updatedAt = Date.now();
    }
  });
  if (fixChanges && fixChanges.changes) {
    return mergeRecordedChanges(changes, fixChanges);
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Individual fixup functions — ported from fixes-post-change.ts
// ---------------------------------------------------------------------------

/**
 * Stamp component.updatedAt = Date.now() on all modified components.
 * Without this, inferUpdatedComponents() excludes the component from merges.
 * Reference: fixes-post-change.ts:133-137
 */
function fixupComponentUpdatedAt(summary: ChangeSummary): void {
  for (const component of summary.updatedComponents) {
    component.updatedAt = Date.now();
  }
}

/**
 * Ensure all new TplNodes have base variant settings.
 * Reference: fixes-post-change.ts:181-188
 */
function fixupBaseVariantSettings(tplMgr: TplMgr, summary: ChangeSummary): void {
  for (const tree of summary.newTrees) {
    for (const node of flattenTpls(tree)) {
      if (isTplTagOrComponent(node)) {
        tplMgr.ensureBaseVariantSetting(node);
      }
    }
  }
}

/**
 * Adjust grid child CSS for new/updated grid containers.
 * Reference: fixes-post-change.ts:194-222
 */
function fixupGridChildren(summary: ChangeSummary): void {
  function fixupGridProps(tag: any): void {
    if (!isGrid(tag) && isTplContainer(tag)) {
      removeAllGridChildProps(tag);
    }
    if (isGrid(tag)) {
      adjustAllGridChildren(tag);
    }
  }

  for (const tree of summary.newTrees) {
    for (const tag of flattenTpls(tree)) {
      if (isTplVariantable(tag)) {
        fixupGridProps(tag);
      }
    }
  }
  for (const node of summary.updatedNodes) {
    if (isTplVariantable(node)) {
      fixupGridProps(node);
    }
  }
}

/**
 * Remove empty tag-list-container elements (ul, ol, li).
 * Reference: fixes-post-change.ts:238-261
 */
function fixupTextTags(summary: ChangeSummary): void {
  for (const tree of summary.newTrees) {
    for (const tag of flattenTpls(tree)) {
      if (
        isTplTag(tag) &&
        isTagListContainer(tag.tag) &&
        tag.children.length === 0 &&
        tag.parent
      ) {
        $$$(tag).remove({ deep: true });
      }
    }
  }
  for (const node of summary.updatedNodes) {
    if (
      isTplTag(node) &&
      isTagListContainer(node.tag) &&
      node.children.length === 0 &&
      node.parent
    ) {
      $$$(node).remove({ deep: true });
    }
  }
}

/**
 * Ensure node names don't conflict within a component.
 * Reference: fixes-post-change.ts:266-274
 */
function fixupIncorrectlyNamedNodes(tplMgr: TplMgr, summary: ChangeSummary): void {
  for (const tree of summary.newTrees) {
    const ownerComponent = getTplOwnerComponent(tree);
    if (ownerComponent) {
      tplMgr.ensureSubtreeCorrectlyNamed(ownerComponent, tree);
    }
  }
}

/**
 * Add/remove implicit states for components.
 * Reference: fixes-post-change.ts:278-307
 */
function fixupImplicitStates(summary: ChangeSummary): void {
  // Remove implicit states for detached nodes
  for (const component of summary.deepUpdatedComponents) {
    const site = tryGetOwnerSite(component);
    if (site) {
      for (let i = component.states.length - 1; i >= 0; i--) {
        const state = component.states[i];
        if (state.tplNode && !isTplAttachedToSite(site, state.tplNode)) {
          removeImplicitStatesAfterRemovingTplNode(site, component, state.tplNode);
        }
      }
    }
  }
  // Ensure correct implicit states for new nodes
  for (const tree of summary.newTrees) {
    const component = $$$(tree).tryGetOwningComponent();
    if (component) {
      const site = tryGetOwnerSite(component);
      if (site) {
        for (const node of flattenTpls(tree)) {
          if (isTplComponent(node) || isTplTag(node)) {
            ensureCorrectImplicitStates(site, component, node);
          }
        }
      }
    }
  }
}

/**
 * Sync virtual slot args for new/updated TplComponents.
 * Reference: fixes-post-change.ts:334-436
 *
 * Adapted: dbCtx.maybeObserveComponents() replaced with no-op — MCP's
 * ChangeTracker already observes all site components.
 */
function fixupVirtualSlotArgs(
  tplMgr: TplMgr,
  summary: Pick<ChangeSummary, "updatedNodes" | "newTrees">
): void {
  const updatedTplSlots = new Set<any>();
  const newTplComponents = new Set<any>();

  const maybeForkArg = (arg: any): void => {
    if (isKnownVirtualRenderExpr(arg.expr)) {
      arg.expr = new RenderExpr({ tpl: [...arg.expr.tpl] });
    }
  };

  for (const newTree of summary.newTrees) {
    for (const newNode of flattenTpls(newTree)) {
      if (isKnownTplSlot(newNode)) {
        updatedTplSlots.add(newNode);
      } else if (isKnownTplComponent(newNode)) {
        newTplComponents.add(newNode);
      }
    }
  }

  for (const node of [...summary.updatedNodes]) {
    if (isKnownTplSlot(node)) {
      updatedTplSlots.add(node);
    } else {
      const parentArgs = findParentArgs(node);
      if (parentArgs.length > 0) {
        for (const parentArg of parentArgs) {
          maybeForkArg(parentArg.arg);
        }
      }
      const parentSlot = findParentSlot(node);
      if (parentSlot) {
        updatedTplSlots.add(parentSlot);
      }
    }
  }

  // Fill virtual slot contents for new TplComponents
  // (Studio calls dbCtx.maybeObserveComponents here — MCP skips as all components are observed)
  for (const tplc of newTplComponents) {
    fillVirtualSlotContents(tplMgr, tplc);
  }

  if (updatedTplSlots.size > 0) {
    const allTplComponents = tplMgr.filterAllNodes(isTplComponent);
    const param2Components = buildParamToComponent(tplMgr.getComponents());
    const affectedComponents = new Set(
      Array.from(updatedTplSlots)
        .map((slot: any) => param2Components.get(slot.param))
        .filter(notNil)
    );
    const affectedTplComponents = allTplComponents.filter((tplc: any) => {
      if (!affectedComponents.has(tplc.component)) {
        return false;
      }
      const slots = Array.from(updatedTplSlots).filter((slot: any) =>
        tplc.component.params.includes(slot.param)
      );
      for (const slot of slots) {
        const arg = $$$(tplc).getSlotArgForParam(slot.param);
        if (isDefaultSlotArg(arg)) {
          return true;
        }
      }
      return false;
    });
    for (const tplc of affectedTplComponents) {
      const slots = Array.from(updatedTplSlots).filter((slot: any) =>
        tplc.component.params.includes(slot.param)
      );
      fillVirtualSlotContents(tplMgr, tplc, slots);
    }
  }
}

/**
 * Reorder slot params to match slot order in the tree.
 * Reference: fixes-post-change.ts:439-457
 */
function fixupSlotParamsOrder(summary: ChangeSummary): void {
  for (const component of summary.updatedComponents) {
    const slotParams = component.params.filter((param: any) =>
      isKnownSlotParam(param)
    );
    if (isCodeComponent(component) || slotParams.length <= 1) {
      continue;
    }
    const slots = flattenTpls(component.tplTree).filter(isTplSlot);
    component.params = [
      ...component.params.filter((param: any) => !isKnownSlotParam(param)),
      ...slots.map((slot: any) => slot.param),
    ];
  }
}

/**
 * Fix frame view modes for page components.
 * Reference: fixes-post-change.ts:146-177
 */
function fixupFrameViewModeByRootSize(site: any): void {
  try {
    for (const frame of getAllSiteFrames(site)) {
      if (
        isPageComponent(frame.container?.component) &&
        frame.viewMode !== "stretch"
      ) {
        frame.viewMode = "stretch";
        const tpl = frame.container?.component?.tplTree;
        if (tpl && isTplVariantable(tpl)) {
          const baseVs = tpl.vsettings?.find((vs: any) =>
            isBaseVariant(vs.variants)
          );
          if (baseVs) {
            const rsh = RSH(baseVs.rs, tpl);
            rsh.set("width", "stretch");
            rsh.set("height", "stretch");
          }
        }
      }
    }
  } catch {
    // Non-critical: skip if frame fixup fails
  }
}
