import {
  usePlasmicCanvasComponentInfo,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";

/** The design-time selection props Plasmic Studio auto-injects into code components. */
export interface OverlayEditorOpenProps {
  /** Studio callback — fire it to tell the editor this overlay auto-opened its content. */
  plasmicNotifyAutoOpenedContent?: () => void;
  /** Carries the current outline-selection state; read via usePlasmicCanvasComponentInfo. */
  __plasmic_selection_prop__?: {
    isSelected: boolean;
    selectedSlotName?: string;
  };
}

/**
 * Returns whether an overlay (drawer/popover panel) should be force-opened for
 * editing in the Studio canvas because its node — or a descendant — is selected
 * in the outline tree, so the designer can see and style it without a manual
 * toggle. Mirrors react-aria's `useIsOpen` auto-open behaviour.
 *
 * If `triggerSlotName` is given, selecting that slot does NOT open the panel —
 * that lets the designer edit the trigger without the panel covering it.
 * Returns `false` outside the canvas (runtime/preview), where the real open
 * state governs instead.
 */
export function useOverlayEditorOpen(
  props: OverlayEditorOpenProps,
  opts: { triggerSlotName?: string } = {}
): boolean {
  const inEditor = !!usePlasmicCanvasContext();
  const selection = usePlasmicCanvasComponentInfo?.(props) ?? null;
  const isSelected = selection?.isSelected ?? false;
  const isTriggerSlotSelected =
    !!opts.triggerSlotName && selection?.selectedSlotName === opts.triggerSlotName;

  const autoOpen = inEditor && isSelected && !isTriggerSlotSelected;
  if (autoOpen) {
    props.plasmicNotifyAutoOpenedContent?.();
  }
  return autoOpen;
}
