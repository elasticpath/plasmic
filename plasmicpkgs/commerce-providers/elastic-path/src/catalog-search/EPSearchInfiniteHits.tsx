/**
 * EPSearchInfiniteHits — catalog search results that grow in place.
 *
 * Wraps `useInfiniteHits()` from react-instantsearch. Each card gets the same
 * `currentProduct` / `currentHit` / `currentProductIndex` as EPSearchHits;
 * `loadMore` appends the next page instead of replacing the current one, and
 * `loadPrevious` prepends the page before the first one shown, for a shopper
 * who reloads a URL that names a later page.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useImperativeHandle } from "react";
import { useInfiniteHits } from "react-instantsearch";
import { Registerable } from "../registerable";
import {
  MOCK_SEARCH_INFINITE_HITS_DATA,
  SearchInfiniteHitsData,
} from "./design-time-data";
import {
  buildHitsGridStyle,
  DEFAULT_GRID_GAP,
  DEFAULT_GRID_TEMPLATE_COLUMNS,
  DEFAULT_PRODUCT_PATH_PREFIX,
  MockSearchHits,
  SearchHitsGrid,
} from "./EPSearchHits";

type PreviewState = "auto" | "withData";

interface EPSearchInfiniteHitsProps {
  children?: React.ReactNode;
  loadMoreButton?: React.ReactNode;
  loadPreviousButton?: React.ReactNode;
  className?: string;
  gridTemplateColumns?: string;
  gridGap?: string;
  productPathPrefix?: string;
  previewState?: PreviewState;
}

interface EPSearchInfiniteHitsActions {
  loadMore(): void;
  loadPrevious(): void;
}

const ROOT_STYLE: React.CSSProperties = { width: "100%", alignSelf: "stretch" };

export const epSearchInfiniteHitsMeta: CodeComponentMeta<EPSearchInfiniteHitsProps> =
  {
    name: "plasmic-commerce-ep-search-infinite-hits",
    displayName: "EP Search Infinite Hits",
    description:
      "Repeats children for each search result, like EP Search Hits, but Load More appends the next page in place. Cards get the same currentProduct, currentHit and currentProductIndex as EP Search Hits. Bind the Load More button to $ctx.searchInfiniteHitsData (isLastPage, loadMore) or the loadMore element action, and hide it when isLastPage. A URL can name a later page, so a shopper who reloads starts there: put a button in Load Previous Button, bound to loadPrevious and hidden when isFirstPage. Must be inside EP Catalog Search Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              { type: "text", value: "Product Name" },
              { type: "text", value: "$0.00" },
            ],
          },
        ],
      },
      loadMoreButton: {
        type: "slot",
        displayName: "Load More Button",
        defaultValue: [{ type: "button", value: "Load more" }],
      },
      loadPreviousButton: {
        type: "slot",
        displayName: "Load Previous Button",
      },
      gridTemplateColumns: {
        type: "string",
        displayName: "Grid Template Columns",
        description:
          "CSS grid-template-columns value applied to the results grid. Defaults to a responsive auto-fill. The Visual Builder strips display/grid styles set in the Style panel from code components, so this prop is the supported way to override the layout.",
        defaultValue: DEFAULT_GRID_TEMPLATE_COLUMNS,
      },
      gridGap: {
        type: "string",
        displayName: "Grid Gap",
        description: "CSS gap between hit cards.",
        defaultValue: DEFAULT_GRID_GAP,
      },
      productPathPrefix: {
        type: "string",
        displayName: "Product Path Prefix",
        description:
          "Route prefix used to build each hit's currentHit.path link (prefix + '/' + slug). Set this to match the storefront's PDP route, e.g. \"/products\".",
        defaultValue: DEFAULT_PRODUCT_PATH_PREFIX,
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
    importName: "EPSearchInfiniteHits",
    parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
    providesData: true,
    refActions: {
      loadMore: {
        description: "Append the next page of results",
        argTypes: [],
      },
      loadPrevious: {
        description: "Prepend the page before the first one shown",
        argTypes: [],
      },
    },
  };

export const EPSearchInfiniteHits = React.forwardRef<
  EPSearchInfiniteHitsActions,
  EPSearchInfiniteHitsProps
>(function EPSearchInfiniteHits(props, ref) {
  const {
    children,
    loadMoreButton,
    loadPreviousButton,
    className,
    gridTemplateColumns = DEFAULT_GRID_TEMPLATE_COLUMNS,
    gridGap = DEFAULT_GRID_GAP,
    productPathPrefix = DEFAULT_PRODUCT_PATH_PREFIX,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  const gridStyle = buildHitsGridStyle(gridTemplateColumns, gridGap);
  const Inner = useMock ? MockInfiniteHits : InfiniteHitsInner;

  return (
    <Inner
      ref={ref}
      className={className}
      gridStyle={gridStyle}
      productPathPrefix={productPathPrefix}
      loadMoreButton={loadMoreButton}
      loadPreviousButton={loadPreviousButton}
    >
      {children}
    </Inner>
  );
});

interface InnerProps {
  children?: React.ReactNode;
  loadMoreButton?: React.ReactNode;
  loadPreviousButton?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
  productPathPrefix: string;
}

const MockInfiniteHits = React.forwardRef<
  EPSearchInfiniteHitsActions,
  InnerProps
>(function MockInfiniteHits(props, ref) {
  const {
    children,
    loadMoreButton,
    loadPreviousButton,
    className,
    gridStyle,
    productPathPrefix,
  } = props;
  useImperativeHandle(ref, () => ({
    loadMore: () => {},
    loadPrevious: () => {},
  }));

  return (
    <DataProvider
      name="searchInfiniteHitsData"
      data={MOCK_SEARCH_INFINITE_HITS_DATA}
    >
      <div
        className={className}
        data-ep-search-infinite-hits=""
        style={ROOT_STYLE}
      >
        {loadPreviousButton}
        <MockSearchHits
          gridStyle={gridStyle}
          productPathPrefix={productPathPrefix}
        >
          {children}
        </MockSearchHits>
        {loadMoreButton}
      </div>
    </DataProvider>
  );
});

const InfiniteHitsInner = React.forwardRef<
  EPSearchInfiniteHitsActions,
  InnerProps
>(function InfiniteHitsInner(props, ref) {
  const {
    children,
    loadMoreButton,
    loadPreviousButton,
    className,
    gridStyle,
    productPathPrefix,
  } = props;
  const { items, isFirstPage, isLastPage, showMore, showPrevious } =
    useInfiniteHits();
  useImperativeHandle(
    ref,
    () => ({ loadMore: showMore, loadPrevious: showPrevious }),
    [showMore, showPrevious]
  );

  const data: SearchInfiniteHitsData = {
    isFirstPage,
    isLastPage,
    loadMore: showMore,
    loadPrevious: showPrevious,
  };

  return (
    <DataProvider name="searchInfiniteHitsData" data={data}>
      <div
        className={className}
        data-ep-search-infinite-hits=""
        style={ROOT_STYLE}
      >
        {loadPreviousButton}
        <SearchHitsGrid
          hits={items}
          gridStyle={gridStyle}
          productPathPrefix={productPathPrefix}
        >
          {children}
        </SearchHitsGrid>
        {loadMoreButton}
      </div>
    </DataProvider>
  );
});

export function registerEPSearchInfiniteHits(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchInfiniteHitsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPSearchInfiniteHits,
    customMeta ?? epSearchInfiniteHitsMeta
  );
}
