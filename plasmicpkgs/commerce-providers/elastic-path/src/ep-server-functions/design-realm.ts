export type EpDesignRealm = "artboard" | "app-host" | null;

let canvasArtboard = false;

export function latchEpCanvasArtboard(): void {
  canvasArtboard = true;
}

export function resetEpCanvasArtboard(): void {
  canvasArtboard = false;
}

// Read per call: Studio injects `__CanvasPkgs` asynchronously. wab reads it in
// canvas/canvas-ctx.ts and frame-ctx/windows.tsx; if either stops, this breaks.
export function currentEpDesignRealm(): EpDesignRealm {
  if (canvasArtboard) return "artboard";
  if (typeof window === "undefined") return null;
  return (window as unknown as { __CanvasPkgs?: unknown }).__CanvasPkgs
    ? "app-host"
    : null;
}
