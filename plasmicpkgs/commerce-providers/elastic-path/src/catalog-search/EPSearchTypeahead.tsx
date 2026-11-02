import {
  DataProvider,
  repeatedElement,
  usePlasmicCanvasComponentInfo,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { DEFAULT_CURRENCY_CODE } from "../const";
import { epMultiSearch } from "../ep-server-functions/multiSearch";
import { Registerable } from "../registerable";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import type { Product } from "../types/product";
import {
  DEFAULT_PRODUCT_PATH_PREFIX,
  PRODUCT_PATH_PREFIX_PROP,
  productHitMeta,
} from "../utils/product-path";
import { cloneWithInjectedHandlers } from "./cloneWithInjectedHandlers";
import {
  MOCK_SEARCH_PRODUCTS,
  SearchTypeaheadData,
  SearchTypeaheadStatus,
} from "./design-time-data";
import { useHeadlessStyling } from "./headless-styling";
import { HITS_CARD_SLOT } from "./hits-grid";
import { groupFilterBy } from "./multi-search-client";
import {
  hitToProduct,
  hitToSearchMeta,
  searchResponseHits,
} from "./search-hit";
import type { SearchHitMeta } from "./search-hit";

type PreviewState = "auto" | "withData" | "loading" | "empty" | "error";

type PanelView = "hits" | "loading" | "empty" | "error" | null;

export const DEFAULT_TYPEAHEAD_DEBOUNCE_MS = 300;
export const DEFAULT_TYPEAHEAD_MIN_QUERY_LENGTH = 2;
export const DEFAULT_TYPEAHEAD_MAX_HITS = 5;
export const DEFAULT_SEARCH_PAGE_PATH = "/search";
export const DEFAULT_SEARCH_QUERY_PARAM = "search[query]";
const DEFAULT_QUERY_BY = "name,description";

interface EPSearchTypeaheadProps {
  input?: React.ReactNode;
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  className?: string;
  panelClassName?: string;
  hitClassName?: string;
  debounceMs?: number;
  minQueryLength?: number;
  maxHits?: number;
  searchPagePath?: string;
  queryParam?: string;
  productPathPrefix?: string;
  queryBy?: string;
  baseFilter?: string;
  previewState?: PreviewState;
  __plasmic_selection_prop__?: {
    isSelected?: boolean;
    selectedSlotName?: string;
  };
  plasmicNotifyAutoOpenedContent?: () => void;
}

export const epSearchTypeaheadMeta: CodeComponentMeta<EPSearchTypeaheadProps> =
  {
    name: "plasmic-commerce-ep-search-typeahead",
    displayName: "EP Search Typeahead",
    description:
      "A search box for a site header. As the shopper types, it lists a few matching products, and submitting goes to the search page. Needs no EP Catalog Search Provider and loads no InstantSearch. Hit cards get the same currentProduct and currentHit as EP Search Hits.",
    props: {
      input: {
        type: "slot",
        displayName: "Search Input",
        description:
          "One input. The typeahead sets its value, keyboard handling and combobox attributes.",
        defaultValue: [
          {
            type: "input",
            attrs: { type: "search", placeholder: "Search products" },
          },
        ],
      },
      children: { ...HITS_CARD_SLOT, displayName: "Hit Card" },
      loadingContent: {
        type: "slot",
        displayName: "Loading Content",
        defaultValue: [{ type: "text", value: "Searching…" }],
      },
      emptyContent: {
        type: "slot",
        displayName: "Empty Content",
        defaultValue: [{ type: "text", value: "No products found" }],
      },
      errorContent: {
        type: "slot",
        displayName: "Error Content",
        defaultValue: [
          { type: "text", value: "Search isn't available. Try again." },
        ],
      },
      panelClassName: {
        type: "class",
        displayName: "Panel Style",
      },
      hitClassName: {
        type: "class",
        displayName: "Hit Style",
        selectors: [
          { selector: ":hover", label: "Hovered" },
          { selector: '[aria-selected="true"]', label: "Active" },
        ],
      },
      debounceMs: {
        type: "number",
        displayName: "Debounce (ms)",
        description: "How long to wait after the last keystroke before searching.",
        defaultValue: DEFAULT_TYPEAHEAD_DEBOUNCE_MS,
      },
      minQueryLength: {
        type: "number",
        displayName: "Minimum Query Length",
        description: "Search only once the query has this many characters.",
        defaultValue: DEFAULT_TYPEAHEAD_MIN_QUERY_LENGTH,
      },
      maxHits: {
        type: "number",
        displayName: "Max Hits",
        description: "How many products to list.",
        defaultValue: DEFAULT_TYPEAHEAD_MAX_HITS,
      },
      searchPagePath: {
        type: "string",
        displayName: "Search Page Path",
        description:
          "Where submitting the search box goes. Put EP Catalog Search Provider on that page.",
        defaultValue: DEFAULT_SEARCH_PAGE_PATH,
      },
      queryParam: {
        type: "string",
        displayName: "Query Parameter",
        description:
          'The URL parameter that carries the query to the search page. "search[query]" is the one EP Catalog Search Provider reads with its default Index Name.',
        defaultValue: DEFAULT_SEARCH_QUERY_PARAM,
      },
      productPathPrefix: PRODUCT_PATH_PREFIX_PROP,
      queryBy: {
        type: "string",
        displayName: "Query By",
        description:
          "Fields to search (comma-separated). Use the same value as EP Catalog Search Provider on the search page.",
        defaultValue: DEFAULT_QUERY_BY,
        advanced: true,
      },
      baseFilter: {
        type: "string",
        displayName: "Base Filter",
        description:
          'Typesense filter_by expression applied to every search, e.g. "meta.product_types:!=child". Use the same value as EP Catalog Search Provider on the search page.',
        defaultValue: "",
        advanced: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "loading", "empty", "error"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Studio only. Auto shows sample products while the typeahead is selected. The others keep the list open in that state.",
        advanced: true,
      },
    } as any,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPSearchTypeahead",
    providesData: true,
  };

export function searchPageUrl(
  path: string,
  queryParam: string,
  query: string
): string {
  const base = path || DEFAULT_SEARCH_PAGE_PATH;
  const term = query.trim();
  if (!term || !queryParam) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${new URLSearchParams([[queryParam, term]])}`;
}

interface TypeaheadSearch {
  status: SearchTypeaheadStatus;
  hits: Record<string, any>[];
}

const IDLE: TypeaheadSearch = { status: "idle", hits: [] };

function useTypeaheadSearch(options: {
  term: string;
  enabled: boolean;
  debounceMs: number;
  maxHits: number;
  queryBy: string;
  baseFilter: string;
}): TypeaheadSearch {
  const { term, enabled, debounceMs, maxHits, queryBy, baseFilter } = options;
  const [search, setSearch] = useState<TypeaheadSearch>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setSearch(IDLE);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      setSearch((previous) => ({ ...previous, status: "loading" }));
      epMultiSearch({
        searches: [
          groupFilterBy({
            type: "search",
            q: term,
            query_by: queryBy,
            per_page: maxHits,
            ...(baseFilter ? { filter_by: baseFilter } : {}),
          }),
        ],
        include: ["main_image"],
      }).then(
        (response) => {
          if (!current) return;
          setSearch({
            status: "success",
            hits: searchResponseHits(response).slice(0, maxHits),
          });
        },
        () => {
          if (current) setSearch({ status: "error", hits: [] });
        }
      );
    }, debounceMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [enabled, term, debounceMs, maxHits, queryBy, baseFilter]);

  return search;
}

function navigate(url: string) {
  window.location.assign(url);
}

export function EPSearchTypeahead(props: EPSearchTypeaheadProps) {
  useHeadlessStyling();
  const {
    input,
    children,
    loadingContent,
    emptyContent,
    errorContent,
    className,
    panelClassName,
    hitClassName,
    searchPagePath = DEFAULT_SEARCH_PAGE_PATH,
    queryParam = DEFAULT_SEARCH_QUERY_PARAM,
    productPathPrefix = DEFAULT_PRODUCT_PATH_PREFIX,
    queryBy = DEFAULT_QUERY_BY,
    baseFilter = "",
    previewState = "auto",
    __plasmic_selection_prop__,
    plasmicNotifyAutoOpenedContent,
  } = props;
  const debounceMs = Math.max(
    0,
    props.debounceMs ?? DEFAULT_TYPEAHEAD_DEBOUNCE_MS
  );
  const minQueryLength = Math.max(
    1,
    props.minQueryLength ?? DEFAULT_TYPEAHEAD_MIN_QUERY_LENGTH
  );
  const maxHits = Math.max(
    1,
    Math.floor(props.maxHits ?? DEFAULT_TYPEAHEAD_MAX_HITS)
  );

  const inEditor = !!usePlasmicCanvasContext();
  const isSelected =
    usePlasmicCanvasComponentInfo?.({ __plasmic_selection_prop__ })
      ?.isSelected ?? false;
  const currencyCode = useEpCommerce()?.currency || DEFAULT_CURRENCY_CODE;

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = `${useId()}-hits`;
  const hitId = (index: number) => `${listboxId}-${index}`;

  const term = query.trim();
  const searchable = !inEditor && term.length >= minQueryLength;
  const search = useTypeaheadSearch({
    term,
    enabled: searchable,
    debounceMs,
    maxHits,
    queryBy,
    baseFilter,
  });

  const results = useMemo<{ product: Product; hit: SearchHitMeta }[]>(() => {
    if (inEditor) {
      return MOCK_SEARCH_PRODUCTS.slice(0, maxHits).map((product) => ({
        product,
        hit: productHitMeta(product, productPathPrefix),
      }));
    }
    return search.hits.map((raw) => {
      const product = hitToProduct(raw, currencyCode);
      return { product, hit: hitToSearchMeta(raw, product, productPathPrefix) };
    });
  }, [inEditor, maxHits, productPathPrefix, search.hits, currencyCode]);

  let view: PanelView;
  let status: SearchTypeaheadStatus;
  if (inEditor) {
    const preview =
      previewState === "auto" ? (isSelected ? "withData" : null) : previewState;
    view = preview === "withData" ? "hits" : preview;
    status =
      view === "loading" ? "loading" : view === "error" ? "error" : view ? "success" : "idle";
  } else {
    status = search.status;
    if (!isOpen || !searchable) view = null;
    else if (status === "error") view = "error";
    else if (results.length > 0) view = "hits";
    else if (status === "loading") view = "loading";
    else if (status === "success") view = "empty";
    else view = null;
  }
  const hitCount = view === "hits" ? results.length : 0;
  const activeHit = view === "hits" && activeIndex < hitCount ? activeIndex : -1;

  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  useEffect(() => {
    if (inEditor && view) plasmicNotifyAutoOpenedContent?.();
  }, [inEditor, view, plasmicNotifyAutoOpenedContent]);

  useEffect(() => {
    if (activeHit < 0) return;
    const option = listboxRef.current?.children[activeHit] as
      | HTMLElement
      | undefined;
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeHit]);

  const close = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const chooseHit = (index: number) => {
    if (inEditor) return;
    const option = listboxRef.current?.children[index] as
      | HTMLElement
      | undefined;
    const link = option?.querySelector<HTMLAnchorElement>("a[href]");
    close();
    if (link) link.click();
    else if (results[index]) navigate(results[index].hit.path);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.defaultPrevented) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          return;
        }
        if (hitCount === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const from = activeHit < 0 && step < 0 ? hitCount : activeHit;
        setActiveIndex((from + step + hitCount) % hitCount);
        return;
      }
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          close();
        } else if (query) {
          event.preventDefault();
          setQuery("");
        }
        return;
      case "Enter":
        if (event.nativeEvent.isComposing || activeHit < 0) return;
        event.preventDefault();
        chooseHit(activeHit);
        return;
    }
  };

  const inputProps: Record<string, unknown> = {
    value: query,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
      setIsOpen(true);
    },
    onFocus: () => setIsOpen(true),
    onKeyDown,
    name: queryParam,
    role: "combobox",
    "aria-expanded": view !== null,
    "aria-controls": view === "hits" ? listboxId : undefined,
    "aria-autocomplete": "list",
    "aria-activedescendant": activeHit >= 0 ? hitId(activeHit) : undefined,
    autoComplete: "off",
    // Keep password-manager extensions off a search field.
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
  };
  let inputElement: React.ReactNode;
  if (input == null) {
    inputProps["aria-label"] = "Search products";
    inputElement = <input type="search" {...inputProps} />;
  } else {
    const own = React.isValidElement(input)
      ? (input.props as Record<string, unknown>)
      : {};
    if (!own["aria-label"] && !own["aria-labelledby"]) {
      inputProps["aria-label"] = "Search products";
    }
    inputElement = cloneWithInjectedHandlers(input, {
      injected: inputProps,
      compose: ["onChange", "onFocus", "onKeyDown"],
    });
  }

  const pageUrl = searchPageUrl(searchPagePath, queryParam, query);
  const data: SearchTypeaheadData = {
    query,
    status,
    isOpen: view !== null,
    hitCount,
    searchPageUrl: pageUrl,
  };

  return (
    <DataProvider name="searchTypeaheadData" data={data}>
      <form
        className={className}
        data-ep-search-typeahead=""
        role="search"
        action={searchPagePath}
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          if (inEditor) return;
          close();
          navigate(pageUrl);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            close();
          }
        }}
      >
        {inputElement}
        {view && (
          <div
            className={panelClassName}
            data-ep-search-typeahead-panel=""
            // Keep focus in the input, or its blur closes the list first.
            onMouseDown={(event) => event.preventDefault()}
          >
            {view === "hits" ? (
              <ul
                ref={listboxRef}
                id={listboxId}
                role="listbox"
                aria-label="Products"
                data-ep-search-typeahead-hits=""
              >
                {results.map(({ product, hit }, i) => (
                  <li
                    key={product.id || i}
                    id={hitId(i)}
                    role="option"
                    aria-selected={i === activeHit}
                    className={hitClassName}
                    data-ep-search-typeahead-hit=""
                    onClick={(event) => {
                      const link = (event.target as Element).closest?.(
                        "a[href]"
                      );
                      if (link && event.currentTarget.contains(link)) {
                        close();
                      } else {
                        chooseHit(i);
                      }
                    }}
                  >
                    <DataProvider name="currentProduct" data={product}>
                      <DataProvider name="currentHit" data={hit}>
                        <DataProvider name="currentProductIndex" data={i}>
                          {repeatedElement(i, children)}
                        </DataProvider>
                      </DataProvider>
                    </DataProvider>
                  </li>
                ))}
              </ul>
            ) : view === "loading" ? (
              loadingContent
            ) : view === "empty" ? (
              emptyContent
            ) : (
              errorContent
            )}
          </div>
        )}
      </form>
    </DataProvider>
  );
}

export function registerEPSearchTypeahead(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchTypeaheadProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchTypeahead, customMeta ?? epSearchTypeaheadMeta);
}
