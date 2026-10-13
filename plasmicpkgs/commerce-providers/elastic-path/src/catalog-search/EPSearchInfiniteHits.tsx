/**
 * EPSearchInfiniteHits — catalog search results with load more.
 *
 * Wraps `useInfiniteHits()` from react-instantsearch. Exposes
 * loadMore/loadPrevious via refActions.
 */

import { DataProvider } from "@plasmicapp/host";
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
import { MockSearchHits, SearchHitsGrid } from "./EPSearchHits";
import {
  HITS_CARD_SLOT,
  HitsGridLayoutProps,
  HitsGridProps,
  hitsGridMetaProps,
  useHitsGrid,
} from "./hits-grid";

interface EPSearchInfiniteHitsProps extends HitsGridLayoutProps {
  children?: React.ReactNode;
  loadMoreButton?: React.ReactNode;
  loadPreviousButton?: React.ReactNode;
  className?: string;
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
      children: HITS_CARD_SLOT,
      loadMoreButton: {
        type: "slot",
        displayName: "Load More Button",
        defaultValue: [{ type: "button", value: "Load more" }],
      },
      loadPreviousButton: {
        type: "slot",
        displayName: "Load Previous Button",
      },
      ...hitsGridMetaProps(
        "CSS grid-template-columns value applied to the results grid. Defaults to a responsive auto-fill. The Visual Builder strips display/grid styles set in the Style panel from code components, so this prop is the supported way to override the layout."
      ),
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
  const { children, loadMoreButton, loadPreviousButton, className } = props;
  const { useMock, gridStyle, productPathPrefix } = useHitsGrid(props);
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

interface InnerProps extends HitsGridProps {
  loadMoreButton?: React.ReactNode;
  loadPreviousButton?: React.ReactNode;
}

const NO_OP_ACTIONS: EPSearchInfiniteHitsActions = {
  loadMore: () => {},
  loadPrevious: () => {},
};

const MockInfiniteHits = React.forwardRef<
  EPSearchInfiniteHitsActions,
  InnerProps
>(function MockInfiniteHits(props, ref) {
  const { children, gridStyle, productPathPrefix, ...shell } = props;
  useImperativeHandle(ref, () => NO_OP_ACTIONS);

  return (
    <InfiniteHitsShell {...shell} data={MOCK_SEARCH_INFINITE_HITS_DATA}>
      <MockSearchHits gridStyle={gridStyle} productPathPrefix={productPathPrefix}>
        {children}
      </MockSearchHits>
    </InfiniteHitsShell>
  );
});

const InfiniteHitsInner = React.forwardRef<
  EPSearchInfiniteHitsActions,
  InnerProps
>(function InfiniteHitsInner(props, ref) {
  const { children, gridStyle, productPathPrefix, ...shell } = props;
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
    <InfiniteHitsShell {...shell} data={data}>
      <SearchHitsGrid
        hits={items}
        gridStyle={gridStyle}
        productPathPrefix={productPathPrefix}
      >
        {children}
      </SearchHitsGrid>
    </InfiniteHitsShell>
  );
});

function InfiniteHitsShell(
  props: Omit<InnerProps, "gridStyle" | "productPathPrefix"> & {
    data: SearchInfiniteHitsData;
  }
) {
  const { data, children, className, loadMoreButton, loadPreviousButton } =
    props;

  return (
    <DataProvider name="searchInfiniteHitsData" data={data}>
      <div
        className={className}
        data-ep-search-infinite-hits=""
        style={ROOT_STYLE}
      >
        {loadPreviousButton}
        {children}
        {loadMoreButton}
      </div>
    </DataProvider>
  );
}

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
