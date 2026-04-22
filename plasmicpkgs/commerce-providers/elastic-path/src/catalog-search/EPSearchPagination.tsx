/**
 * EPSearchPagination — pagination controls for catalog search.
 *
 * Wraps `usePagination()` from react-instantsearch. Exposes pagination state
 * and goToPage/nextPage/prevPage actions via refActions.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle } from "react";
import { Registerable } from "../registerable";
import { MOCK_SEARCH_PAGINATION_DATA } from "./design-time-data";
import type { SearchPaginationData } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPSearchPaginationProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

interface EPSearchPaginationActions {
  goToPage(page: number): void;
  nextPage(): void;
  prevPage(): void;
}

export const epSearchPaginationMeta: CodeComponentMeta<EPSearchPaginationProps> = {
  name: "plasmic-commerce-ep-search-pagination",
  displayName: "EP Search Pagination",
  description:
    "Pagination controls for catalog search. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: {
        type: "text",
        value: "Page 1 of 4",
      },
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
  importName: "EPSearchPagination",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
  refActions: {
    goToPage: {
      description: "Navigate to a specific page (0-indexed)",
      argTypes: [{ name: "page", type: "number" }],
    },
    nextPage: {
      description: "Navigate to the next page",
      argTypes: [],
    },
    prevPage: {
      description: "Navigate to the previous page",
      argTypes: [],
    },
  },
};

export const EPSearchPagination = React.forwardRef<
  EPSearchPaginationActions,
  EPSearchPaginationProps
>(function EPSearchPagination(props, ref) {
  const { children, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockSearchPagination ref={ref} className={className}>
        {children}
      </MockSearchPagination>
    );
  }

  return (
    <EPSearchPaginationInner ref={ref} className={className}>
      {children}
    </EPSearchPaginationInner>
  );
});

const MockSearchPagination = React.forwardRef<
  EPSearchPaginationActions,
  { children?: React.ReactNode; className?: string }
>(function MockSearchPagination({ children, className }, ref) {
  useImperativeHandle(ref, () => ({
    goToPage: () => {},
    nextPage: () => {},
    prevPage: () => {},
  }));

  return (
    <DataProvider
      name="searchPaginationData"
      data={MOCK_SEARCH_PAGINATION_DATA}
    >
      <div className={className} data-ep-search-pagination="">
        {children}
      </div>
    </DataProvider>
  );
});

const EPSearchPaginationInner = React.forwardRef<
  EPSearchPaginationActions,
  { children?: React.ReactNode; className?: string }
>(function EPSearchPaginationInner({ children, className }, ref) {
  const { usePagination } = require("react-instantsearch");
  const {
    currentRefinement,
    nbPages,
    pages,
    refine,
    isFirstPage,
    isLastPage,
  } = usePagination();

  const handleGoToPage = useCallback(
    (page: number) => {
      const safePage = Math.max(0, Math.min(page, nbPages - 1));
      refine(safePage);
    },
    [refine, nbPages]
  );

  const handleNextPage = useCallback(() => {
    if (!isLastPage) {
      refine(currentRefinement + 1);
    }
  }, [refine, currentRefinement, isLastPage]);

  const handlePrevPage = useCallback(() => {
    if (!isFirstPage) {
      refine(currentRefinement - 1);
    }
  }, [refine, currentRefinement, isFirstPage]);

  useImperativeHandle(ref, () => ({
    goToPage: handleGoToPage,
    nextPage: handleNextPage,
    prevPage: handlePrevPage,
  }));

  const paginationData: SearchPaginationData = {
    currentPage: currentRefinement,
    totalPages: nbPages,
    hasNext: !isLastPage,
    hasPrev: !isFirstPage,
    pages,
  };

  return (
    <DataProvider name="searchPaginationData" data={paginationData}>
      <div className={className} data-ep-search-pagination="">
        {children}
      </div>
    </DataProvider>
  );
});

export function registerEPSearchPagination(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchPaginationProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPSearchPagination,
    customMeta ?? epSearchPaginationMeta
  );
}
