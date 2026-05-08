/**
 * EPSearchAutocompletePanel — panel bridge.
 *
 * Owns the wrapper element for the autocomplete dropdown:
 *   <div data-ep-autocomplete-panel> + spread getPanelProps()
 *
 * Visibility rules:
 *   Runtime  — render iff state.isOpen.
 *   Canvas   — render iff the panel (or any descendant) is selected in
 *              Studio's outline, OR the designer has set `open={true}` to
 *              pin it open. Closed by default so the dropdown does not
 *              cover neighbouring page content while editing other parts.
 *
 * The selection branch follows the @plasmicapp/host
 * `usePlasmicCanvasComponentInfo` pattern used by react-aria's Popover,
 * Modal, ComboBox, etc. — Plasmic Studio injects
 * `__plasmic_selection_prop__` automatically.
 *
 * Includes one component-owned chrome element — the mobile close button at
 * `data-ep-autocomplete-close` — gated by media query in the headless
 * styling block. This is the documented L2 exception: a fresh drop on
 * mobile would otherwise trap the shopper in a panel they cannot dismiss.
 */

import {
  usePlasmicCanvasContext,
  usePlasmicCanvasComponentInfo,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { useEPAutocompleteContextOptional } from "./EPAutocompleteContext";

interface EPSearchAutocompletePanelProps {
  children?: React.ReactNode;
  className?: string;
  /**
   * Studio-only override: when true, force the panel to render in canvas
   * even if it isn't selected. Useful for deep styling sessions where the
   * designer wants the panel pinned open while editing siblings.
   */
  open?: boolean;
  /** Injected automatically by Plasmic Studio. Do not set manually. */
  __plasmic_selection_prop__?: {
    isSelected?: boolean;
    selectedSlotName?: string;
  };
  /** Injected automatically by Plasmic Studio. Do not set manually. */
  plasmicNotifyAutoOpenedContent?: () => void;
}

export const epSearchAutocompletePanelMeta: CodeComponentMeta<EPSearchAutocompletePanelProps> =
  {
    name: "plasmic-commerce-ep-search-autocomplete-panel",
    displayName: "EP Search Autocomplete Panel",
    description:
      "Panel wrapper for the autocomplete dropdown. In Studio, opens when selected; closed otherwise so it doesn't cover surrounding page content. Hosts the mobile close button (hidden on desktop via media query). Must be inside EP Search Autocomplete.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-search-autocomplete-list",
          },
        ],
      },
      open: {
        type: "boolean",
        defaultValue: false,
        displayName: "Force open (Studio only)",
        description:
          "Pin the panel open in the Studio canvas. No effect at runtime — runtime visibility is controlled by the autocomplete state machine.",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPSearchAutocompletePanel",
    parentComponentName: "plasmic-commerce-ep-search-autocomplete",
  };

export function EPSearchAutocompletePanel(
  props: EPSearchAutocompletePanelProps
) {
  const {
    children,
    className,
    open: openOverride,
    __plasmic_selection_prop__,
    plasmicNotifyAutoOpenedContent,
  } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const isSelected =
    usePlasmicCanvasComponentInfo?.({ __plasmic_selection_prop__ })
      ?.isSelected ?? false;
  const ctx = useEPAutocompleteContextOptional();

  const isOpenInCanvas = inEditor && (openOverride || isSelected);

  React.useEffect(() => {
    if (isOpenInCanvas) {
      plasmicNotifyAutoOpenedContent?.();
    }
  }, [isOpenInCanvas, plasmicNotifyAutoOpenedContent]);

  if (!ctx) {
    return null;
  }

  if (inEditor ? !isOpenInCanvas : !ctx.state.isOpen) {
    return null;
  }

  const panelProps = ctx.getPanelProps({});

  return (
    <div
      {...panelProps}
      className={className}
      data-ep-autocomplete-panel=""
    >
      <button
        type="button"
        data-ep-autocomplete-close=""
        aria-label="Close suggestions"
        onClick={() => ctx.clear()}
      >
        Close
      </button>
      {children}
    </div>
  );
}

export function registerEPSearchAutocompletePanel(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchAutocompletePanelProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPSearchAutocompletePanel,
    customMeta ?? epSearchAutocompletePanelMeta
  );
}
