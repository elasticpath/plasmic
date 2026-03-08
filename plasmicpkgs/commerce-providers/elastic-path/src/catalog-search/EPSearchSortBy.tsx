/**
 * EPSearchSortBy — sort order selector for catalog search.
 *
 * Wraps `useSortBy()` from react-instantsearch. Exposes sortByData and
 * a setSort action for Plasmic interactions.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useImperativeHandle } from "react";
import { Registerable } from "../registerable";
import { MOCK_SORT_BY_DATA } from "./design-time-data";
import type { SortByData } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPSearchSortByProps {
  children?: React.ReactNode;
  items?: Array<{ value: string; label: string }>;
  className?: string;
  previewState?: PreviewState;
}

interface EPSearchSortByActions {
  setSort(value: string): void;
}

export const epSearchSortByMeta: ComponentMeta<EPSearchSortByProps> = {
  name: "plasmic-commerce-ep-search-sort-by",
  displayName: "EP Search Sort By",
  description:
    "Sort order selector for catalog search. Must be inside EP Catalog Search Provider.",
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
        'Array of { value, label } objects, e.g. [{ value: "price:asc", label: "Price: Low to High" }]',
      defaultValue: [
        { value: "relevance", label: "Most Relevant" },
        { value: "price:asc", label: "Price: Low to High" },
        { value: "price:desc", label: "Price: High to Low" },
      ],
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

export const EPSearchSortBy = React.forwardRef<
  EPSearchSortByActions,
  EPSearchSortByProps
>(function EPSearchSortBy(props, ref) {
  const { children, items, className, previewState = "auto" } = props;

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
    <EPSearchSortByInner ref={ref} items={items} className={className}>
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
    items?: Array<{ value: string; label: string }>;
    className?: string;
  }
>(function EPSearchSortByInner({ children, items, className }, ref) {
  const { useSortBy } = require("react-instantsearch");

  const sortByItems = items || MOCK_SORT_BY_DATA.options;
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

export function registerEPSearchSortBy(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPSearchSortByProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchSortBy, customMeta ?? epSearchSortByMeta);
}
