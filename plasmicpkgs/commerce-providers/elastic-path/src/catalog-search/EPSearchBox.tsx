/**
 * EPSearchBox — provider for catalog-search field state.
 *
 * Renders no DOM. Wraps `useSearchBox()` from react-instantsearch and
 * exposes `searchFieldData` ({ value, displayValue, isEmpty }) via
 * DataProvider plus `setValue`/`clear` ref-actions.
 *
 * The visible chrome (input, clear button) is owned by the designer —
 * they drop Plasmic-controlled `<input>` and `<button>` elements into
 * this component's slot and bind them via `$ctx.searchFieldData` and
 * the registered ref-actions. See PRD #308 for the full rationale.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Registerable } from "../registerable";
import { MOCK_SEARCH_FIELD_DATA } from "./design-time-data";
import type { SearchFieldData } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPSearchBoxProps {
  children?: React.ReactNode;
  debounceMs?: number;
  previewState?: PreviewState;
  /**
   * @deprecated Pre-PRD #308 prop. The new EPSearchBox is a provider with
   * no DOM, so this value has no effect. Set the placeholder on the
   * Plasmic input you drop into the slot. Kept here so existing project
   * bundles stay valid against the registered metadata.
   */
  placeholder?: string;
  /** @deprecated See `placeholder`. Set autoFocus on the slot's input. */
  autoFocus?: boolean;
  /** @deprecated See `placeholder`. Toggle visibility on the slot's clear button. */
  showClear?: boolean;
}

interface EPSearchBoxActions {
  setValue(value: string): void;
  clear(): void;
}

export const epSearchBoxMeta: CodeComponentMeta<EPSearchBoxProps> = {
  name: "plasmic-commerce-ep-search-box",
  displayName: "EP Search Box",
  description:
    "Search field provider. Drops a Plasmic input and clear button into the slot, bind them to $ctx.searchFieldData (value, displayValue, isEmpty) and the setValue/clear ref-actions. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "vbox",
          styles: { width: "100%" },
          children: [
            {
              type: "input",
              attrs: {
                type: "search",
                placeholder: "Search products...",
              },
            },
            {
              type: "button",
              value: "Clear",
            },
          ],
        },
      ],
    },
    debounceMs: {
      type: "number",
      defaultValue: 300,
      displayName: "Debounce (ms)",
      description: "Milliseconds to wait before refining the search",
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
    // Deprecated — pre-PRD #308 props preserved so existing project bundles
    // referencing these names stay valid against the new metadata. They have
    // no runtime effect; set placeholder/autofocus/showclear on the Plasmic
    // input or button you drop into the slot.
    placeholder: {
      type: "string",
      advanced: true,
      hidden: () => true,
    },
    autoFocus: {
      type: "boolean",
      advanced: true,
      hidden: () => true,
    },
    showClear: {
      type: "boolean",
      advanced: true,
      hidden: () => true,
    },
  } as any,
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPSearchBox",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
  refActions: {
    setValue: {
      description: "Update the search field value",
      argTypes: [{ name: "value", type: "string" }],
    },
    clear: {
      description: "Clear the search field",
      argTypes: [],
    },
  },
};

export const EPSearchBox = React.forwardRef<
  EPSearchBoxActions,
  EPSearchBoxProps
>(function EPSearchBox(props, ref) {
  const { children, debounceMs = 300, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockSearchBox ref={ref}>
        {children}
      </MockSearchBox>
    );
  }

  return (
    <EPSearchBoxInner ref={ref} debounceMs={debounceMs}>
      {children}
    </EPSearchBoxInner>
  );
});

const MockSearchBox = React.forwardRef<
  EPSearchBoxActions,
  { children?: React.ReactNode }
>(function MockSearchBox({ children }, ref) {
  useImperativeHandle(ref, () => ({
    setValue: () => {},
    clear: () => {},
  }));

  return (
    <DataProvider name="searchFieldData" data={MOCK_SEARCH_FIELD_DATA}>
      {children}
    </DataProvider>
  );
});

const EPSearchBoxInner = React.forwardRef<
  EPSearchBoxActions,
  { children?: React.ReactNode; debounceMs: number }
>(function EPSearchBoxInner({ children, debounceMs }, ref) {
  const { useSearchBox } = require("react-instantsearch");
  const { query: refinedQuery, refine, clear: refineClear } = useSearchBox();

  const [value, setValueState] = useState(refinedQuery ?? "");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefine = useCallback(
    (next: string) => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        refine(next);
      }, debounceMs);
    },
    [debounceMs, refine]
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setValue: (next: string) => {
        setValueState(next);
        scheduleRefine(next);
      },
      clear: () => {
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
        }
        setValueState("");
        refineClear();
      },
    }),
    [scheduleRefine, refineClear]
  );

  const data: SearchFieldData = {
    value,
    displayValue: refinedQuery ?? "",
    isEmpty: value.length === 0,
  };

  return (
    <DataProvider name="searchFieldData" data={data}>
      {children}
    </DataProvider>
  );
});

export function registerEPSearchBox(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchBoxProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchBox, customMeta ?? epSearchBoxMeta);
}
