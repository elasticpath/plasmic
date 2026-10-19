import { usePlasmicCanvasContext } from "@plasmicapp/host";

/**
 * The Preview State a component acts on: the saved one on the Studio canvas,
 * "auto" on a published page, so shoppers never see sample data.
 */
export function useCanvasPreviewState<T extends string>(
  previewState: T | undefined
): T | "auto" {
  const inCanvas = !!usePlasmicCanvasContext();
  return inCanvas && previewState ? previewState : "auto";
}
