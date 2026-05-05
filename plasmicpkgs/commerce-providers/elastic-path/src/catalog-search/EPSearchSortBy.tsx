/**
 * EPSearchSortBy — sort order selector for catalog search.
 *
 * Wraps `useSortBy()` from react-instantsearch. Exposes sortByData and
 * a setSort action for Plasmic interactions.
 *
 * Items accept two shapes:
 *
 *   1. Ergonomic (recommended):
 *      { field: "price.USD.float_price", direction: "asc", label: "..." }
 *      The component composes `${indexName}/sort/${field}:${direction}` —
 *      the format the EP catalog-search-instantsearch-adapter expects.
 *
 *   2. Raw (escape hatch):
 *      { value: "search/sort/foo:asc", label: "..." }
 *      Passed directly to `useSortBy.refine(value)`. Use when you need
 *      full control of the index name.
 *
 *   The "default sort" item (no `field`/`direction` and no `value`) maps
 *   to the bare `indexName` — i.e. unsorted/relevance.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useImperativeHandle, useMemo } from "react";
import { Registerable } from "../registerable";
import { MOCK_SORT_BY_DATA } from "./design-time-data";
import type { SortByData } from "./design-time-data";

type PreviewState = "auto" | "withData";

type SortItem =
  | { field?: undefined; direction?: undefined; value?: string; label: string }
  | {
      field: string;
      direction: "asc" | "desc";
      value?: undefined;
      label: string;
    };

interface EPSearchSortByProps {
  children?: React.ReactNode;
  items?: SortItem[];
  /**
   * Base catalog-search index name. Must match the `indexName` prop on
   * the parent EPCatalogSearchProvider (default "search"). Used to
   * compose values for `{field, direction}` items.
   */
  indexName?: string;
  className?: string;
  previewState?: PreviewState;
}

interface EPSearchSortByActions {
  setSort(value: string): void;
}

export const epSearchSortByMeta: CodeComponentMeta<EPSearchSortByProps> = {
  name: "plasmic-commerce-ep-search-sort-by",
  displayName: "EP Search Sort By",
  description:
    "Sort order selector for catalog search. Must be inside EP Catalog Search Provider. Bind a <select> in the slot to $ctx.sortByData and wire onChange to the setSort ref-action.",
  props: {
    children: {
      type: "slot",
      defaultValue: {
        type: "text",
        value: "Sort: Most Relevant",
      },
    },
    items: {
      type: "object",
      displayName: "Sort Options",
      description:
        'Array of sort options. Recommended shape: { field, direction, label } — e.g. { field: "price.USD.float_price", direction: "asc", label: "Price: Low to High" }. Omit field/direction (just { label }) for the default/unsorted entry. For full control use { value, label } where value is a raw indexName like "search/sort/foo:asc".',
      defaultValue: [
        { label: "Most Relevant" },
        {
          field: "price.USD.float_price",
          direction: "asc",
          label: "Price: Low to High",
        },
        {
          field: "price.USD.float_price",
          direction: "desc",
          label: "Price: High to Low",
        },
        { field: "name", direction: "asc", label: "Name: A to Z" },
      ],
    },
    indexName: {
      type: "string",
      displayName: "Index Name",
      description:
        "Base catalog-search index name. Must match the parent EPCatalogSearchProvider's indexName (default 'search').",
      defaultValue: "search",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPSearchSortBy",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
  refActions: {
    setSort: {
      description: "Change the sort order",
      argTypes: [{ name: "value", type: "string" }],
    },
  },
};

/**
 * Compose a useSortBy item value from an ergonomic SortItem shape.
 * The catalog-search-instantsearch-adapter parses the indexName via the
 * regex `^(.+?)(?=(/sort/(.*))|$)` — so a value of `"<indexName>"` means
 * default ordering, and `"<indexName>/sort/<typesense_sort_by>"` invokes
 * a sorted variant. We compose values to match that contract.
 */
function composeSortValue(item: SortItem, indexName: string): string {
  if ("value" in item && item.value !== undefined) {
    return item.value;
  }
  if ("field" in item && item.field !== undefined && item.direction) {
    return `${indexName}/sort/${item.field}:${item.direction}`;
  }
  return indexName;
}

export const EPSearchSortBy = React.forwardRef<
  EPSearchSortByActions,
  EPSearchSortByProps
>(function EPSearchSortBy(props, ref) {
  const {
    children,
    items,
    indexName = "search",
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockSearchSortBy ref={ref} className={className}>
        {children}
      </MockSearchSortBy>
    );
  }

  return (
    <EPSearchSortByInner
      ref={ref}
      items={items}
      indexName={indexName}
      className={className}
    >
      {children}
    </EPSearchSortByInner>
  );
});

const MockSearchSortBy = React.forwardRef<
  EPSearchSortByActions,
  { children?: React.ReactNode; className?: string }
>(function MockSearchSortBy({ children, className }, ref) {
  useImperativeHandle(ref, () => ({
    setSort: () => {},
  }));

  return (
    <DataProvider name="sortByData" data={MOCK_SORT_BY_DATA}>
      <div className={className} data-ep-search-sort-by="">
        {children}
      </div>
    </DataProvider>
  );
});

const EPSearchSortByInner = React.forwardRef<
  EPSearchSortByActions,
  {
    children?: React.ReactNode;
    items?: SortItem[];
    indexName: string;
    className?: string;
  }
>(function EPSearchSortByInner({ children, items, indexName, className }, ref) {
  const { useSortBy } = require("react-instantsearch");

  // Normalise items into the `{value, label}` shape useSortBy expects.
  // Done in a memo so identity is stable across renders.
  const sortByItems = useMemo(() => {
    const raw = items && items.length ? items : DEFAULT_ITEMS;
    return raw.map((item) => ({
      value: composeSortValue(item, indexName),
      label: item.label,
    }));
  }, [items, indexName]);

  const { currentRefinement, options, refine } = useSortBy({
    items: sortByItems,
  });

  useImperativeHandle(ref, () => ({
    setSort: (value: string) => refine(value),
  }));

  const sortByData: SortByData = {
    currentValue: currentRefinement,
    options,
  };

  return (
    <DataProvider name="sortByData" data={sortByData}>
      <div className={className} data-ep-search-sort-by="">
        {children}
      </div>
    </DataProvider>
  );
});

const DEFAULT_ITEMS: SortItem[] = [
  { label: "Most Relevant" },
  {
    field: "price.USD.float_price",
    direction: "asc",
    label: "Price: Low to High",
  },
  {
    field: "price.USD.float_price",
    direction: "desc",
    label: "Price: High to Low",
  },
  { field: "name", direction: "asc", label: "Name: A to Z" },
];

export function registerEPSearchSortBy(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchSortByProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchSortBy, customMeta ?? epSearchSortByMeta);
}
