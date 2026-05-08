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
 * Also exposes a top-level `placeholder` prop so designers can set the
 * placeholder text from the right rail without drilling into slot attrs.
 * autocomplete-core's `getInputProps()` does not return a `placeholder`
 * key, so we inject it ourselves; designers who'd rather hard-code it on
 * the slot child can leave the prop blank — `cloneElement` preserves the
 * existing attr.
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
  placeholder?: string;
  previewState?: PreviewState;
}

const DEFAULT_PLACEHOLDER = "Search products...";

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
            },
          },
        ],
      },
      placeholder: {
        type: "string",
        displayName: "Placeholder",
        defaultValue: DEFAULT_PLACEHOLDER,
        description:
          "Shown when the input is empty. Overrides any placeholder set directly on the slot input.",
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
  // Default at the function-arg level so existing component instances
  // (dropped before the `placeholder` prop existed) still pick up the
  // default — Plasmic does not retroactively apply meta defaultValue.
  // Designers who want no placeholder set the prop to "" explicitly.
  const { children, className, placeholder = DEFAULT_PLACEHOLDER } = props;
  const ctx = useEPAutocompleteContextOptional();

  if (!ctx) {
    // Outside an EPSearchAutocomplete provider — render the slot raw so
    // designers see *something* in the canvas even if the parent isn't set.
    return <>{children}</>;
  }

  const inputProps = ctx.getInputProps({});
  const child = React.Children.only(children as React.ReactElement);
  const injected: Record<string, unknown> = {
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
  };
  if (placeholder !== undefined && placeholder !== "") {
    injected.placeholder = placeholder;
  }
  const cloned = cloneWithInjectedHandlers(child, {
    injected,
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
