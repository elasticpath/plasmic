/**
 * EPSearchAutocomplete — provider for catalog-search query suggestions.
 *
 * Owns one autocomplete-core instance via `useEPAutocompleteState`. Renders
 * a single positioning wrapper (`<div data-ep-autocomplete-root>`) plus a
 * Plasmic DataProvider exposing `autocompleteData` ({ isOpen, query,
 * collections }) for designer bindings. The three bridge components
 * (Input, Panel, List) consume the prop-getters via the internal
 * EPAutocompleteContext.
 *
 * Editor branch: renders mock collections without touching autocomplete-core
 * or the EP client. Runtime branch: wires postMultiSearch from the EP
 * shopper SDK and runs the live state machine.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle, useMemo } from "react";
import { useCommerce } from "../elastic-path";
import { Registerable } from "../registerable";
import { getEPClient } from "../utils/getEPClient";
import {
  AutocompleteData,
  MOCK_AUTOCOMPLETE_DATA,
} from "./design-time-data";
import {
  EPAutocompleteContext,
  EPAutocompleteContextValue,
} from "./EPAutocompleteContext";
import { useHeadlessStyling } from "./headless-styling";
import {
  useEPAutocompleteState,
  UseEPAutocompleteStateConfig,
} from "./useEPAutocompleteState";
import {
  MultiSearchBody,
  MultiSearchResponse,
} from "./predictionsSource";

type PreviewState = "auto" | "withData";

interface EPSearchAutocompleteProps {
  children?: React.ReactNode;
  className?: string;
  predictionsField?: string;
  debounceMs?: number;
  enableRecentSearches?: boolean;
  recentSearchesKey?: string;
  recentSearchesLimit?: number;
  /** Advanced: additional autocomplete-core plugins. Hidden in Studio. */
  plugins?: any[];
  previewState?: PreviewState;
}

interface EPSearchAutocompleteActions {
  setQuery(value: string): void;
  focus(): void;
  clear(): void;
}

export const epSearchAutocompleteMeta: CodeComponentMeta<EPSearchAutocompleteProps> =
  {
    name: "plasmic-commerce-ep-search-autocomplete",
    displayName: "EP Search Autocomplete",
    description:
      "Provider for query-suggestion autocomplete, sourced from EP catalog-search's autocomplete endpoint. Compose with EP Search Autocomplete Input, Panel, and List children. Must be inside EP Catalog Search Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            styles: { width: "100%" },
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-search-autocomplete-input",
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-search-autocomplete-panel",
              },
            ],
          },
        ],
      },
      predictionsField: {
        type: "string",
        defaultValue: "q",
        displayName: "Predictions Field",
        description:
          "Suggestion field name in the EP autocomplete collection (default 'q').",
      },
      debounceMs: {
        type: "number",
        defaultValue: 300,
        displayName: "Debounce (ms)",
        description: "Milliseconds to wait before mirroring input → search query.",
      },
      enableRecentSearches: {
        type: "boolean",
        defaultValue: false,
        displayName: "Enable Recent Searches",
        description:
          "When on, persists picked queries to localStorage via the autocomplete-core plugin. Off by default.",
      },
      recentSearchesKey: {
        type: "string",
        displayName: "Recent Searches Key",
        description: "localStorage key for recent searches (default ep-recent-searches).",
        advanced: true,
      },
      recentSearchesLimit: {
        type: "number",
        defaultValue: 3,
        displayName: "Recent Searches Limit",
        advanced: true,
      },
      plugins: {
        type: "object",
        displayName: "Plugins (advanced)",
        description:
          "Escape hatch: extra autocomplete-core plugins to inject. Most consumers do not need this.",
        advanced: true,
        hidden: () => true,
      } as any,
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        advanced: true,
      },
    } as any,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPSearchAutocomplete",
    parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
    providesData: true,
    refActions: {
      setQuery: {
        description: "Set the autocomplete query value programmatically.",
        argTypes: [{ name: "value", type: "string" }],
      },
      focus: {
        description: "Open the panel programmatically.",
        argTypes: [],
      },
      clear: {
        description: "Clear the query and close the panel.",
        argTypes: [],
      },
    },
  };

export const EPSearchAutocomplete = React.forwardRef<
  EPSearchAutocompleteActions,
  EPSearchAutocompleteProps
>(function EPSearchAutocomplete(props, ref) {
  useHeadlessStyling();
  const {
    children,
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockAutocomplete ref={ref} className={className}>
        {children}
      </MockAutocomplete>
    );
  }

  return (
    <EPSearchAutocompleteInner
      ref={ref}
      className={className}
      predictionsField={props.predictionsField ?? "q"}
      debounceMs={props.debounceMs ?? 300}
      enableRecentSearches={props.enableRecentSearches ?? false}
      recentSearchesKey={props.recentSearchesKey}
      recentSearchesLimit={props.recentSearchesLimit}
      plugins={props.plugins}
    >
      {children}
    </EPSearchAutocompleteInner>
  );
});

const MockAutocomplete = React.forwardRef<
  EPSearchAutocompleteActions,
  { children?: React.ReactNode; className?: string }
>(function MockAutocomplete({ children, className }, ref) {
  useImperativeHandle(ref, () => ({
    setQuery: () => undefined,
    focus: () => undefined,
    clear: () => undefined,
  }));

  const noop = () => undefined;
  const ctx: EPAutocompleteContextValue = useMemo(
    () => ({
      state: {
        query: MOCK_AUTOCOMPLETE_DATA.query,
        isOpen: MOCK_AUTOCOMPLETE_DATA.isOpen,
        activeItemId: 0,
        collections: MOCK_AUTOCOMPLETE_DATA.collections.map((c) => ({
          source: { sourceId: c.sourceId },
          items: c.items,
        })),
      },
      collections: MOCK_AUTOCOMPLETE_DATA.collections,
      getInputProps: () => ({
        value: MOCK_AUTOCOMPLETE_DATA.query,
        onChange: noop,
      }),
      getPanelProps: () => ({}),
      getListProps: () => ({ role: "listbox" }),
      getItemProps: ({ item }: any) => ({
        role: "option",
        "aria-selected": "false",
        onClick: noop,
        "data-item-q": item?.q,
      }),
      getRootProps: () => ({}),
      getEnvironmentProps: () => ({}),
      setQuery: noop,
      focus: noop,
      clear: noop,
      submit: noop,
    }),
    []
  );

  return (
    <EPAutocompleteContext.Provider value={ctx}>
      <DataProvider name="autocompleteData" data={MOCK_AUTOCOMPLETE_DATA}>
        <div className={className} data-ep-autocomplete-root="">
          {children}
        </div>
      </DataProvider>
    </EPAutocompleteContext.Provider>
  );
});

interface EPSearchAutocompleteInnerProps
  extends Omit<UseEPAutocompleteStateConfig, "postMultiSearch"> {
  children?: React.ReactNode;
  className?: string;
}

const EPSearchAutocompleteInner = React.forwardRef<
  EPSearchAutocompleteActions,
  EPSearchAutocompleteInnerProps
>(function EPSearchAutocompleteInner(props, ref) {
  const { children, className, ...stateConfig } = props;

  const { providerRef } = useCommerce();
  const provider = providerRef?.current;
  const epClient = getEPClient(provider);

  const postMultiSearch = useCallback(
    async (body: MultiSearchBody): Promise<MultiSearchResponse> => {
      try {
        const sdk = require("@epcc-sdk/sdks-shopper");
        const result = await sdk.postMultiSearch({
          client: epClient,
          body,
        });
        return (result?.data ?? {}) as MultiSearchResponse;
      } catch {
        return {};
      }
    },
    [epClient]
  );

  const hookOutput = useEPAutocompleteState({
    ...stateConfig,
    postMultiSearch,
  });

  useImperativeHandle(
    ref,
    () => ({
      setQuery: hookOutput.setQuery,
      focus: hookOutput.focus,
      clear: hookOutput.clear,
    }),
    [hookOutput.setQuery, hookOutput.focus, hookOutput.clear]
  );

  const publicData: AutocompleteData = useMemo(
    () => ({
      isOpen: !!hookOutput.state.isOpen,
      query: hookOutput.state.query ?? "",
      collections: hookOutput.collections,
    }),
    [hookOutput.state.isOpen, hookOutput.state.query, hookOutput.collections]
  );

  return (
    <EPAutocompleteContext.Provider value={hookOutput}>
      <DataProvider name="autocompleteData" data={publicData}>
        <div className={className} data-ep-autocomplete-root="">
          {children}
        </div>
      </DataProvider>
    </EPAutocompleteContext.Provider>
  );
});

export function registerEPSearchAutocomplete(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchAutocompleteProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPSearchAutocomplete,
    customMeta ?? epSearchAutocompleteMeta
  );
}
