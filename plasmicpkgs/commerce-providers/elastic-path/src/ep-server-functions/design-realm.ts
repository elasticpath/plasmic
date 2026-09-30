/**
 * Which design-time realm, if any, the current call is running in.
 *
 * Two realms, two signals, because neither is observable from the other:
 *
 * - **Canvas artboard.** `usePlasmicCanvasContext()` bridged here by
 *   `markEpCanvasArtboard`. Authoritative where a raw `#canvas=true` hash read
 *   is spoofable: the context defaults to `false` and its Provider mounts only
 *   inside `_PlasmicCanvasHost`.
 * - **App-host document**, where Studio's data-query Configure panel resolves
 *   and executes registered `ep.*` bodies. `window.__CanvasPkgs`, read **per
 *   call**: Studio injects it asynchronously, so a module-eval snapshot bakes
 *   in `undefined`.
 *
 * `__CanvasPkgs` was chosen over `#plasmic-studio-script` and
 * `window.__PLASMIC_ARTBOARD`, which are each written and never read. Two wab
 * call sites read it into `Sub` — `wab/client/components/canvas/canvas-ctx.ts`
 * and `wab/client/frame-ctx/windows.tsx` — so it cannot be dropped without
 * breaking the canvas.
 */

/** `"artboard"` and `"app-host"` are design time; `null` is a live storefront. */
export type EpDesignRealm = "artboard" | "app-host" | null;

let canvasArtboard = false;

/**
 * Latches this module instance as a Studio artboard, one way. Called during
 * render, not from an effect, so the flag is set before any descendant
 * fetches. Nothing clears it: a document that has rendered an artboard once is
 * an artboard for as long as it lives.
 */
export function latchEpCanvasArtboard(): void {
  canvasArtboard = true;
}

/** Test seam. Production code only ever sets the flag. */
export function resetEpCanvasArtboard(): void {
  canvasArtboard = false;
}

export function currentEpDesignRealm(): EpDesignRealm {
  if (canvasArtboard) return "artboard";
  if (typeof window === "undefined") return null;
  return (window as unknown as { __CanvasPkgs?: unknown }).__CanvasPkgs
    ? "app-host"
    : null;
}
