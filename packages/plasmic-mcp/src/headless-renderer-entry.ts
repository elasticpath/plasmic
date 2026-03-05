/**
 * Headless Renderer Entry Point
 *
 * esbuild entry for the browser-targeted headless renderer bundle.
 * This bundle is injected into a Playwright-managed Chromium page and exposes
 * WAB rendering functions on `window.__HeadlessRenderer`.
 *
 * The rendering pipeline reuses Plasmic Studio's own canvas rendering logic:
 * - `renderTplNode` converts a TplNode + RenderingCtx → React element
 * - The React element is passed to `setPlasmicRootNode` in a canvas iframe
 * - The iframe's dev host provides React and SubDeps at runtime
 *
 * `makeEmptyRenderingCtx` is not exported from canvas-rendering.ts, so we
 * provide a local `makeRenderingCtx` that constructs a minimal RenderingCtx
 * without requiring a full ViewCtx. This avoids modifying upstream WAB files.
 */

import {
  renderTplNode,
  type RenderingCtx,
} from "@/wab/client/components/canvas/canvas-rendering";
import { wrapWithContext } from "@/wab/shared/contexts";
import { unbundleSite } from "@/wab/shared/core/tagged-unbundle";
import { FastBundler } from "@/wab/shared/bundler";
import { computedProjectFlags } from "@/wab/shared/cached-selectors";
import type { SubDeps } from "@/wab/client/components/canvas/subdeps";
import type { Site } from "@/wab/shared/model/classes";

/**
 * Construct a minimal RenderingCtx for headless rendering.
 *
 * The full `makeEmptyRenderingCtx` in canvas-rendering.ts requires a ViewCtx
 * with StudioCtx, CanvasCtx, etc. For headless screenshots we only need:
 * - `sub`: SubDeps from the canvas iframe's `window.__Sub`
 * - `site`: deserialized Site from the project bundle
 * - `valKey`: a stable key for the rendered component tree
 *
 * Fields that reference Studio UI state (isDraggingObject, showSlotPlaceholders,
 * etc.) are set to safe defaults since there is no interactive Studio.
 */
function makeRenderingCtx(opts: {
  sub: SubDeps;
  site: Site;
  valKey: string;
}): RenderingCtx {
  const emptyEnv = {
    $ctx: {},
    $props: {},
    $state: {},
    $queries: {},
    $refs: {},
    $$: {},
    currentUser: {},
    $dataTokens: {},
  };

  // Minimal ViewCtx duck-type: provides the fields that renderTplNode
  // accesses at runtime. The full ViewCtx class has hundreds of methods
  // but renderTplNode only reads a subset during basic rendering.
  const viewCtxDuck = {
    site: opts.site,
    canvasCtx: { Sub: opts.sub },
    studioCtx: {
      showSlotPlaceholder: () => false,
      showContainerPlaceholder: () => false,
      isDraggingObject: () => false,
      site: opts.site,
    },
    viewMode: () => "live",
    focusedTpl: () => null,
    variantTplMgr: () => ({
      getTargetVariantComboForNode: () => [],
      getActiveVariantSetting: () => undefined,
    }),
  };

  return {
    activeVariants: new Set(),
    env: { ...emptyEnv },
    wrappingEnv: { ...emptyEnv },
    ownersStack: [],
    reactHookSpecs: [],
    triggerProps: {},
    nodeNamer: undefined,
    ownerComponent: undefined,
    ownerKey: undefined,
    overrides: {},
    projectFlags: computedProjectFlags(opts.site),
    rootClassName: "",
    site: opts.site,
    sub: opts.sub,
    valKey: opts.valKey,
    viewCtx: viewCtxDuck as any,
    visibilityOptions: {
      showSlotPlaceholders: false,
      showContainersPlaceholders: false,
    },
    isDraggingObject: false,
    $stateSnapshot: {},
    setDollarQueries: () => {},
    stateSpecs: [],
    plasmicInvalidate: undefined,
    $ccVariants: {},
    updateVariant: () => {},
  } as RenderingCtx;
}

// Expose on window for Playwright orchestration from headless-canvas.ts
(window as any).__HeadlessRenderer = {
  renderTplNode,
  wrapWithContext,
  makeRenderingCtx,
  unbundleSite,
  FastBundler,
};
