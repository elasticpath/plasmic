/**
 * EPSearchAutocompletePanel — panel bridge.
 *
 * Owns the wrapper element for the autocomplete dropdown:
 *   <div data-ep-autocomplete-panel> + spread getPanelProps()
 * Renders only when `state.isOpen` is true at runtime; in the editor it
 * always renders so designers see their layout. Includes one component-
 * owned chrome element — the mobile close button at
 * `data-ep-autocomplete-close` — gated by media query in the headless
 * styling block. This is the documented L2 exception: a fresh drop on
 * mobile would otherwise trap the shopper in a panel they cannot dismiss.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { useEPAutocompleteContextOptional } from "./EPAutocompleteContext";

type PreviewState = "auto" | "withData";

interface EPSearchAutocompletePanelProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epSearchAutocompletePanelMeta: CodeComponentMeta<EPSearchAutocompletePanelProps> =
  {
    name: "plasmic-commerce-ep-search-autocomplete-panel",
    displayName: "EP Search Autocomplete Panel",
    description:
      "Panel wrapper for the autocomplete dropdown. Renders only when the panel is open. Hosts the mobile close button (hidden on desktop via media query). Must be inside EP Search Autocomplete.",
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
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
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
  const { children, className } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const ctx = useEPAutocompleteContextOptional();

  if (!ctx) {
    return null;
  }

  // Editor: always render so designers can lay out the panel against
  // mock collections. Runtime: only render when state.isOpen.
  if (!inEditor && !ctx.state.isOpen) {
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
