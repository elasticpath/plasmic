import { usePlasmicCanvasContext } from "@plasmicapp/host";
import { latchEpCanvasArtboard } from "./design-realm";

/**
 * Bridges Studio's canvas context into the module-level design-time flag that
 * the browser transport reads.
 *
 * Called during render, not from an effect, so the flag is set before any
 * descendant's first fetch. `usePlasmicCanvasContext` is the authoritative
 * artboard signal — the context defaults to `false` and its Provider mounts
 * only inside `_PlasmicCanvasHost`, where a raw `#canvas=true` hash read is
 * spoofable.
 */
export function useEpDesignRealmBridge(): void {
  if (usePlasmicCanvasContext()) latchEpCanvasArtboard();
}
