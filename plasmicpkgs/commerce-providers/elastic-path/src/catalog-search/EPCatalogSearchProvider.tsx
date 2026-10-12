/**
 * EPCatalogSearchProvider — root provider for catalog search.
 *
 * Wraps children in `<InstantSearchNext>` with the EP Catalog Search
 * adapter. Handles client initialization, URL routing, and global search
 * configuration.
 *
 * At design time, renders children with mock data (no real search calls).
 * At runtime, server-renders the first page of results where the page can
 * carry them (the Next.js App Router), and searches in the browser otherwise.
 */

import * as catalogSearchAdapterModule from "@elasticpath/catalog-search-instantsearch-adapter";
import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import { ServerInsertedHTMLContext } from "next/navigation.js";
import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Configure,
  useInstantSearch,
  useInstantSearchContext,
  useRSCContext,
  useSearchBox,
} from "react-instantsearch";
import { InstantSearchNext } from "react-instantsearch-nextjs";
import { readEpErrorCode } from "../browser-call";
import { DEFAULT_CURRENCY_CODE } from "../const";
import { Registerable } from "../registerable";
import type { CatalogSearchData } from "./design-time-data";
import { MOCK_CATALOG_SEARCH_DATA } from "./design-time-data";
import { useHeadlessStyling } from "./headless-styling";
import {
  CatalogSearchServerPass,
  createMultiSearchClient,
} from "./multi-search-client";
import { catalogSearchErrorCopy } from "./search-error-copy";

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
        description:
          "Rendered when a search fails to run. Leave empty to show the built-in message, which names the cause. No hits is not a failure and renders the results area empty instead.",
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

  const outerInsertHTML = useContext(ServerInsertedHTMLContext);
  const slotKey = useId();
  const [serverPass] = useState<CatalogSearchServerPass>(() => ({
    outcome: "pending",
  }));
  const insertHTML = useCallback(
    (callback: () => React.ReactNode) => {
      if (serverPass.outcome !== "success" || !outerInsertHTML) return;
      outerInsertHTML(() =>
        toSlotScript(callback(), slotKey, serverPass.nonce)
      );
    },
    [outerInsertHTML, serverPass, slotKey]
  );
  useHydrateFromSlot(slotKey);

  // Create the search client from the EP adapter
  const searchClient = useMemo(() => {
    try {
      // The published 0.0.5 build ships an esbuild __toESM(..., 1)
      // double-wrap, so `mod.default` is `{ default: <class>, __esModule: true }`
      // instead of the class itself. Unwrap defensively to handle both shapes.
      const mod = catalogSearchAdapterModule as any;
      const CatalogSearchInstantSearchAdapter =
        typeof mod.default === "function"
          ? mod.default
          : mod.default?.default ?? mod;
      const adapter = new CatalogSearchInstantSearchAdapter({
        // Not an Elastic Path client: the one `.post()` the adapter reaches
        // for runs the search through `epMultiSearch` instead.
        client: createMultiSearchClient(serverPass),
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
  }, [queryBy, highlightFullFields, serverPass]);

  if (!searchClient) {
    return (
      <div className={className} data-ep-catalog-search-provider="">
        <div data-ep-catalog-search-error="">
          {errorContent || (
            <div>
              Search is unavailable: the catalog-search adapter could not be
              loaded.
            </div>
          )}
        </div>
      </div>
    );
  }

  const searchTree = (
    <>
      <ServerPassRelease serverPass={serverPass} />
      {/* `filters` rides through the adapter's _adaptFilters, which always
          joins it (&&) with facet refinements — unlike the adapter-level
          `additionalSearchParameters.filter_by`, which is silently DROPPED
          whenever InstantSearch generates its own filters (i.e. as soon as
          any facet is refined). Must be Typesense filter_by syntax. */}
      <Configure
        hitsPerPage={hitsPerPage}
        {...(baseFilter ? { filters: baseFilter } : {})}
      />
      <QueryState />
      <EPCatalogSearchBody
        serverPass={serverPass}
        className={className}
        currencyCode={currencyCode}
        errorContent={errorContent}
      >
        {children}
      </EPCatalogSearchBody>
    </>
  );

  // Outside the App Router InstantSearchNext cannot render on the server: it
  // reads `next/headers`, which throws there. Rendering nothing matches the
  // browser's first render, which is empty until InstantSearch starts.
  const renderable = typeof window !== "undefined" || outerInsertHTML != null;

  return (
    <ServerInsertedHTMLContext.Provider value={insertHTML}>
      {renderable ? (
        <InstantSearchNext
          searchClient={searchClient}
          indexName={indexName}
          routing={enableUrlSync}
        >
          {searchTree}
        </InstantSearchNext>
      ) : null}
    </ServerInsertedHTMLContext.Provider>
  );
}

const INITIAL_RESULTS = Symbol.for("InstantSearchInitialResults");
const SLOT_NAME = "@elasticpath/ep-catalog-search-initial-results";
const INITIAL_RESULTS_SLOT = Symbol.for(SLOT_NAME);
const SLOT_EXPRESSION = `window[Symbol.for(${JSON.stringify(SLOT_NAME)})]`;
const UPSTREAM_SCRIPT_PREFIX =
  'window[Symbol.for("InstantSearchInitialResults")] = ';

type ResultsWindow = Window & {
  [INITIAL_RESULTS]?: unknown;
  [INITIAL_RESULTS_SLOT]?: Record<string, unknown>;
};

/**
 * Rewrites InstantSearchNext's results script to fill this provider's own
 * slot. Upstream writes one page-wide global, so a second provider on the
 * page would hydrate from the first one's results. Anything not shaped as
 * expected inserts nothing, and the browser searches instead.
 */
function toSlotScript(
  node: React.ReactNode,
  slotKey: string,
  nonce: string | undefined
): React.ReactNode {
  if (!React.isValidElement(node) || node.type !== "script") return null;
  const props = node.props as {
    nonce?: string;
    dangerouslySetInnerHTML?: { __html?: unknown };
  };
  const html = props.dangerouslySetInnerHTML?.__html;
  if (typeof html !== "string" || !html.startsWith(UPSTREAM_SCRIPT_PREFIX)) {
    return null;
  }
  const json = html.slice(UPSTREAM_SCRIPT_PREFIX.length);
  const key = JSON.stringify(slotKey).replace(
    /[<>&]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  return (
    <script
      nonce={nonce ?? props.nonce}
      dangerouslySetInnerHTML={{
        __html: `(${SLOT_EXPRESSION} = ${SLOT_EXPRESSION} || {})[${key}] = ${json}`,
      }}
    />
  );
}

/**
 * Points InstantSearchNext at this provider's server results before it reads
 * them on its first render, and drops them once mounted.
 */
function useHydrateFromSlot(slotKey: string) {
  const mounted = useRef(false);
  if (!mounted.current && typeof window !== "undefined") {
    const w = window as ResultsWindow;
    w[INITIAL_RESULTS] = w[INITIAL_RESULTS_SLOT]?.[slotKey];
  }
  useEffect(() => {
    mounted.current = true;
    delete (window as ResultsWindow)[INITIAL_RESULTS_SLOT]?.[slotKey];
  }, [slotKey]);
}

/**
 * Gives the search client a way to end the server render with no results.
 *
 * Resolving InstantSearchNext's wait alone is not enough: with a search sent
 * and no results, its `getInitialResults` throws, and the widgets waiting on
 * it rethrow into the render. Clearing `_hasSearchWidget` first makes it
 * serialize nothing instead.
 */
function suspendOn(promise: Promise<unknown>): void {
  const use = (React as { use?: (p: Promise<unknown>) => unknown }).use;
  if (use) {
    use(promise);
    return;
  }
  throw promise;
}

function ServerPassRelease(props: { serverPass: CatalogSearchServerPass }) {
  const { resolveWaitForResultsRef } = useRSCContext();
  const search = useInstantSearchContext();
  props.serverPass.release = () => {
    (search as unknown as { _hasSearchWidget: boolean })._hasSearchWidget =
      false;
    resolveWaitForResultsRef?.current?.();
  };
  return null;
}

/**
 * InstantSearch applies a URL's `query` only while a search-box widget is
 * mounted, and a page needs no search box to show results for a shared link.
 */
function QueryState() {
  useSearchBox();
  return null;
}

/**
 * Renders the search surface and, when a search fails, the error slot above it.
 *
 * The error slot stays rather than soft-failing to no hits: a search box that
 * is always empty looks exactly like one that works and matches nothing. The
 * children stay mounted alongside it so the shopper can change the query and
 * try again — the common failures here are transient.
 */
function EPCatalogSearchBody(props: {
  children?: React.ReactNode;
  errorContent?: React.ReactNode;
  className?: string;
  currencyCode: string;
  serverPass: CatalogSearchServerPass;
}) {
  const { children, errorContent, className, currencyCode, serverPass } = props;
  const { waitForResultsRef } = useRSCContext();
  const { status, error } = useInstantSearch({ catchError: true });
  if (typeof window === "undefined") {
    // The browser's first render without server results is empty, so a
    // server pass that found none renders nothing either.
    const serverResults = waitForResultsRef?.current;
    if (serverResults?.status === "pending") suspendOn(serverResults);
    if (serverPass.outcome !== "success") return null;
  }
  const failed = status === "error";

  const catalogSearchData: CatalogSearchData = {
    isSearchActive: true,
    query: "",
    currencyCode,
    ...(failed
      ? {
          error: {
            code: readEpErrorCode(error),
            message: catalogSearchErrorCopy(error),
          },
        }
      : {}),
  };

  return (
    <DataProvider name="catalogSearchData" data={catalogSearchData}>
      <div className={className} data-ep-catalog-search-provider="">
        {failed ? (
          <div data-ep-catalog-search-error="">
            {errorContent || <div>{catalogSearchErrorCopy(error)}</div>}
          </div>
        ) : null}
        {children}
      </div>
    </DataProvider>
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
