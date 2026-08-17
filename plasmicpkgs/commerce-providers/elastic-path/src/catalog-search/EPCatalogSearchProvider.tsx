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
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { Registerable } from "../registerable";
import { DEFAULT_CURRENCY_CODE } from "../const";
import { MOCK_CATALOG_SEARCH_DATA } from "./design-time-data";
import type { CatalogSearchData } from "./design-time-data";
import { useHeadlessStyling } from "./headless-styling";

type PreviewState = "auto" | "withData" | "loading" | "empty" | "error";

interface EPCatalogSearchProviderProps {
  children?: React.ReactNode;
  errorContent?: React.ReactNode;
  className?: string;
  indexName?: string;
  queryBy?: string;
  baseFilter?: string;
  highlightFullFields?: string;
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
      baseFilter: {
        type: "string",
        displayName: "Base Filter",
        description:
          'Typesense filter_by expression applied to EVERY search, combined (&&) with any facet refinements — e.g. "meta.product_types:!=child" to exclude variation children from hits. Leave empty for no base filter.',
        defaultValue: "",
      },
      highlightFullFields: {
        type: "string",
        displayName: "Highlight Full Fields",
        description:
          'Comma-separated fields highlighted in full instead of snippeted (Typesense highlight_full_fields) — e.g. "name". Long fields like description are snippeted by default.',
        defaultValue: "",
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
  useHeadlessStyling();

  const {
    children,
    errorContent,
    className,
    indexName = "search",
    queryBy = "name,description",
    baseFilter = "",
    highlightFullFields = "",
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
        <div className={className} data-ep-catalog-search-provider="">
          Loading...
        </div>
      );
    }
    if (previewState === "error") {
      return (
        <div className={className} data-ep-catalog-search-provider="">
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
          <div className={className} data-ep-catalog-search-provider="">
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
        <div className={className} data-ep-catalog-search-provider="">
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
      baseFilter={baseFilter}
      highlightFullFields={highlightFullFields}
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
  baseFilter?: string;
  highlightFullFields?: string;
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
    baseFilter,
    highlightFullFields,
    hitsPerPage,
    enableUrlSync,
    currencyCode,
    className,
  } = props;

  const commerce = useEpCommerce();
  const client = commerce?.client;

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
          // Typesense snippets long fields by default; fields listed here are
          // highlighted in full (`<mark>`-wrapped) instead.
          ...(highlightFullFields
            ? { highlight_full_fields: highlightFullFields }
            : {}),
        },
        // Inline the product image record onto each hit. Adapter v0.1.0+
        // forwards this as `?include=main_image` on the catalog-search call
        // and resolves `relationships.main_image` against the returned
        // `included` block, so `hit.main_image.link.href` is populated and
        // EPSearchHits can render real product images without a follow-up
        // round-trip per hit.
        include: ["main_image"],
      });
      return adapter.searchClient || adapter;
    } catch (e) {
      console.error(
        "EPCatalogSearchProvider: Failed to create search client.",
        e
      );
      return null;
    }
  }, [client, queryBy, highlightFullFields]);

  if (!searchClient) {
    return (
      <div className={className} data-ep-catalog-search-provider="">
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
      {/* `filters` rides through the adapter's _adaptFilters, which always
          joins it (&&) with facet refinements — unlike the adapter-level
          `additionalSearchParameters.filter_by`, which is silently DROPPED
          whenever InstantSearch generates its own filters (i.e. as soon as
          any facet is refined). Must be Typesense filter_by syntax. */}
      <Configure
        hitsPerPage={hitsPerPage}
        {...(baseFilter ? { filters: baseFilter } : {})}
      />
      <DataProvider name="catalogSearchData" data={catalogSearchData}>
        <div className={className} data-ep-catalog-search-provider="">
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
