/**
 * EPSearchAutocompleteInput — input bridge.
 *
 * Spreads `getInputProps()` onto the designer's slot input element via
 * cloneElement (Pattern C — value, onChange, onKeyDown, onFocus, onBlur).
 * Single-element-slot semantics: the slot must contain one valid React
 * element (default `<input type="search">`). If a designer drops an array
 * or non-element child, we fall back to rendering it untouched — the
 * onSubmit / selection paths still work via the surrounding panel + list.
 *
 * No DOM is owned by this component beyond what the slot provides.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { cloneWithInjectedHandlers } from "./cloneWithInjectedHandlers";
import { useEPAutocompleteContextOptional } from "./EPAutocompleteContext";

type PreviewState = "auto" | "withData";

interface EPSearchAutocompleteInputProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epSearchAutocompleteInputMeta: CodeComponentMeta<EPSearchAutocompleteInputProps> =
  {
    name: "plasmic-commerce-ep-search-autocomplete-input",
    displayName: "EP Search Autocomplete Input",
    description:
      "Input bridge for EP Search Autocomplete. Drop a Plasmic <input> into the slot and this component spreads value + onChange + keyboard handlers automatically. Must be inside EP Search Autocomplete.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "input",
            attrs: {
              type: "search",
              placeholder: "Search products...",
            },
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
    } as any,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPSearchAutocompleteInput",
    parentComponentName: "plasmic-commerce-ep-search-autocomplete",
  };

export function EPSearchAutocompleteInput(
  props: EPSearchAutocompleteInputProps
) {
  const { children, className } = props;
  const ctx = useEPAutocompleteContextOptional();

  if (!ctx) {
    // Outside an EPSearchAutocomplete provider — render the slot raw so
    // designers see *something* in the canvas even if the parent isn't set.
    return <>{children}</>;
  }

  const inputProps = ctx.getInputProps({});
  const child = React.Children.only(children as React.ReactElement);
  const cloned = cloneWithInjectedHandlers(child, {
    injected: {
      ...inputProps,
      className: [className, (child.props as any)?.className]
        .filter(Boolean)
        .join(" ") || undefined,
      // Tell common password-manager extensions (1Password, LastPass,
      // Bitwarden, Dashlane) to skip this input. Without these hints,
      // some extensions stamp `caret-color: transparent !important` on
      // the input to indicate autofill availability — which hides the
      // user's typing caret on a search field where it doesn't belong.
      "data-1p-ignore": "true",
      "data-lpignore": "true",
      "data-bwignore": "true",
      "data-form-type": "other",
    },
    compose: ["onChange", "onKeyDown", "onFocus", "onBlur"],
  });

  return <>{cloned}</>;
}

export function registerEPSearchAutocompleteInput(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchAutocompleteInputProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPSearchAutocompleteInput,
    customMeta ?? epSearchAutocompleteInputMeta
  );
}
