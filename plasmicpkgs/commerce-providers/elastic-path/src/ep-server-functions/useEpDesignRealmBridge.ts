import { usePlasmicCanvasContext } from "@plasmicapp/host";
import { latchEpCanvasArtboard } from "./design-realm";

export function useEpDesignRealmBridge(): void {
  if (usePlasmicCanvasContext()) latchEpCanvasArtboard();
}
