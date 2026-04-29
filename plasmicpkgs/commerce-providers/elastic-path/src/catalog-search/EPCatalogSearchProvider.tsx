/**
 * EPCatalogSearchProvider — root provider for catalog search.
 *
 * Wraps children in `<InstantSearch>` from react-instantsearch with the
 * EP Catalog Search adapter. Handles client initialization, URL routing,
 * and global search configuration.
 *
 * At design time, renders children with mock data (no real search calls).
 * At runtime, initializes the adapter from the ElasticPathProvider context
 * and provides full search capabilities.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { useCommerce } from "../elastic-path";
import { Registerable } from "../registerable";
import { DEFAULT_CURRENCY_CODE } from "../const";
import { getEPClient } from "../utils/getEPClient";
import { MOCK_CATALOG_SEARCH_DATA } from "./design-time-data";
import type { CatalogSearchData } from "./design-time-data";

type PreviewState = "auto" | "withData" | "loading" | "empty" | "error";

// Defensive default — Plasmic strips display/grid styles from code component
// instances, and centered flex-column page shells (the most common Plasmic
// layout) collapse children to content-width unless the child explicitly
// stretches. Without this, the entire catalog-search subtree renders at
// max-content width regardless of how the surrounding page is configured.
const DEFAULT_PROVIDER_WRAPPER_STYLE: React.CSSProperties = {
  width: "100%",
  alignSelf: "stretch",
};

interface EPCatalogSearchProviderProps {
  children?: React.ReactNode;
  errorContent?: React.ReactNode;
  className?: string;
  indexName?: string;
  queryBy?: string;
  hitsPerPage?: number;
  enableUrlSync?: boolean;
  currencyCode?: string;
  previewState?: PreviewState;
}

export const epCatalogSearchProviderMeta: CodeComponentMeta<EPCatalogSearchProviderProps> =
  {
    name: "plasmic-commerce-ep-catalog-search-provider",
    displayName: "EP Catalog Search Provider",
    description:
      "Root provider for Elastic Path Catalog Search. Wraps InstantSearch with the EP adapter. Place search components (EP Search Box, EP Search Hits, etc.) as children.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-search-box",
              },
              {
                type: "hbox",
                children: [
                  {
                    type: "component",
                    name: "plasmic-commerce-ep-search-hits",
                  },
                ],
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-search-pagination",
              },
            ],
          },
        ],
      },
      errorContent: {
        type: "slot",
        displayName: "Error Content",
        defaultValue: {
          type: "text",
          value:
            "Catalog Search is not available. Ensure it is enabled for this store.",
        },
      },
      indexName: {
        type: "string",
        displayName: "Index Name",
        description: "InstantSearch index name",
        defaultValue: "search",
      },
      queryBy: {
        type: "string",
        displayName: "Query By",
        description: "Fields to search (comma-separated)",
        defaultValue: "name,description",
      },
      hitsPerPage: {
        type: "number",
        displayName: "Hits Per Page",
        description: "Number of results per page",
        defaultValue: 12,
      },
      enableUrlSync: {
        type: "boolean",
        displayName: "Enable URL Sync",
        description: "Sync search state to URL",
        defaultValue: true,
      },
      currencyCode: {
        type: "string",
        displayName: "Currency Code",
        description: "Currency code for price fields",
        defaultValue: "USD",
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "loading", "empty", "error"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCatalogSearchProvider",
    providesData: true,
  };

export function EPCatalogSearchProvider(props: EPCatalogSearchProviderProps) {
  const {
    children,
    errorContent,
    className,
    indexName = "search",
    queryBy = "name,description",
    hitsPerPage = 12,
    enableUrlSync = true,
    currencyCode = DEFAULT_CURRENCY_CODE,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // --- Design-time preview handling ---
  if (inEditor) {
    if (previewState === "loading") {
      return (
        <div className={className} style={DEFAULT_PROVIDER_WRAPPER_STYLE} data-ep-catalog-search-provider="">
          Loading...
        </div>
      );
    }
    if (previewState === "error") {
      return (
        <div className={className} style={DEFAULT_PROVIDER_WRAPPER_STYLE} data-ep-catalog-search-provider="">
          {errorContent}
        </div>
      );
    }
    if (previewState === "empty") {
      return (
        <DataProvider
          name="catalogSearchData"
          data={{
            ...MOCK_CATALOG_SEARCH_DATA,
            isSearchActive: false,
            query: "",
          }}
        >
          <div className={className} style={DEFAULT_PROVIDER_WRAPPER_STYLE} data-ep-catalog-search-provider="">
            {children}
          </div>
        </DataProvider>
      );
    }
  }

  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <DataProvider name="catalogSearchData" data={MOCK_CATALOG_SEARCH_DATA}>
        <div className={className} style={DEFAULT_PROVIDER_WRAPPER_STYLE} data-ep-catalog-search-provider="">
          {children}
        </div>
      </DataProvider>
    );
  }

  // --- Runtime rendering ---
  return (
    <EPCatalogSearchProviderInner
      indexName={indexName}
      queryBy={queryBy}
      hitsPerPage={hitsPerPage}
      enableUrlSync={enableUrlSync}
      currencyCode={currencyCode}
      className={className}
      errorContent={errorContent}
    >
      {children}
    </EPCatalogSearchProviderInner>
  );
}

function EPCatalogSearchProviderInner(props: {
  children?: React.ReactNode;
  errorContent?: React.ReactNode;
  indexName: string;
  queryBy: string;
  hitsPerPage: number;
  enableUrlSync: boolean;
  currencyCode: string;
  className?: string;
}) {
  const {
    children,
    errorContent,
    indexName,
    queryBy,
    hitsPerPage,
    enableUrlSync,
    currencyCode,
    className,
  } = props;

  const { providerRef } = useCommerce();
  const provider = providerRef?.current;
  const client = getEPClient(provider);

  // Create the search client from the EP adapter
  const searchClient = useMemo(() => {
    if (!client) return null;
    try {
      // Dynamic require — the adapter is a default export.
      // The published 0.0.5 build ships an esbuild __toESM(..., 1)
      // double-wrap, so `mod.default` is `{ default: <class>, __esModule: true }`
      // instead of the class itself. Unwrap defensively to handle both shapes.
      const mod = require("@elasticpath/catalog-search-instantsearch-adapter");
      const CatalogSearchInstantSearchAdapter =
        typeof mod.default === "function"
          ? mod.default
          : mod.default?.default ?? mod;
      const adapter = new CatalogSearchInstantSearchAdapter({
        client,
        additionalSearchParameters: {
          query_by: queryBy,
        },
      });
      return adapter.searchClient || adapter;
    } catch (e) {
      console.error(
        "EPCatalogSearchProvider: Failed to create search client.",
        e
      );
      return null;
    }
  }, [client, queryBy]);

  if (!searchClient) {
    return (
      <div className={className} style={DEFAULT_PROVIDER_WRAPPER_STYLE} data-ep-catalog-search-provider="">
        {errorContent || (
          <div>
            Catalog Search is not available. Ensure the adapter is installed and
            the store has Catalog Search enabled.
          </div>
        )}
      </div>
    );
  }

  // Dynamic require to avoid hard dependency
  const { InstantSearch, Configure } = require("react-instantsearch");

  const catalogSearchData: CatalogSearchData = {
    isSearchActive: true,
    query: "",
    currencyCode,
  };

  return (
    <InstantSearch
      searchClient={searchClient}
      indexName={indexName}
      routing={enableUrlSync}
    >
      <Configure hitsPerPage={hitsPerPage} />
      <DataProvider name="catalogSearchData" data={catalogSearchData}>
        <div className={className} style={DEFAULT_PROVIDER_WRAPPER_STYLE} data-ep-catalog-search-provider="">
          {children}
        </div>
      </DataProvider>
    </InstantSearch>
  );
}

export function registerEPCatalogSearchProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCatalogSearchProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCatalogSearchProvider,
    customMeta ?? epCatalogSearchProviderMeta
  );
}
