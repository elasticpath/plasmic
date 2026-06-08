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
import { buildPageItems } from "./pagination-window";

type PreviewState = "auto" | "withData";

const DEFAULT_WINDOW_SIZE = 7;

interface EPSearchPaginationProps {
  children?: React.ReactNode;
  className?: string;
  windowSize?: number;
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
  section: "EP Catalog Search",
  description:
    "Pagination provider. Drops a Prev button, page-indicator text, and Next button into the slot. Bind text to $ctx.searchPaginationData (currentPage, totalPages, hasNext, hasPrev) and wire button onClick to the prevPage/nextPage ref-actions; hide buttons when !hasPrev / !hasNext. For a numbered pager, dataRep over $ctx.searchPaginationData.pageItems (windowed, with ellipsis + each item's bound goTo). Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "hbox",
          styles: {
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
          },
          children: [
            {
              type: "button",
              value: "Prev",
            },
            {
              type: "text",
              value: "Page 1 of 4",
            },
            {
              type: "button",
              value: "Next",
            },
          ],
        },
      ],
    },
    windowSize: {
      type: "number",
      displayName: "Window Size",
      description:
        "How many numbered page links to show around the current page in pageItems (first/last pages are always anchored, with ellipsis sentinels for the gaps).",
      defaultValue: DEFAULT_WINDOW_SIZE,
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
  const {
    children,
    className,
    windowSize = DEFAULT_WINDOW_SIZE,
    previewState = "auto",
  } = props;

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
    <EPSearchPaginationInner
      ref={ref}
      className={className}
      windowSize={windowSize}
    >
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
  { children?: React.ReactNode; className?: string; windowSize: number }
>(function EPSearchPaginationInner({ children, className, windowSize }, ref) {
  const { usePagination } = require("react-instantsearch");
  const {
    currentRefinement,
    nbPages,
    pages,
    refine,
    isFirstPage,
    isLastPage,
  } = usePagination({ padding: Math.max(0, Math.floor((windowSize - 1) / 2)) });

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

  // goTo/next/prev ride along in the data context (same pattern as
  // EPRefinementList's per-item `toggle`) so designers can wire clicks via
  // customFunction interactions ($ctx.searchPaginationData.goTo(page))
  // without reaching the component ref.
  const paginationData: SearchPaginationData = {
    currentPage: currentRefinement,
    totalPages: nbPages,
    hasNext: !isLastPage,
    hasPrev: !isFirstPage,
    pages,
    // Windowed page-item model (D4) — each item carries its own bound goTo.
    pageItems: buildPageItems(pages, nbPages, currentRefinement, handleGoToPage),
    goTo: handleGoToPage,
    next: handleNextPage,
    prev: handlePrevPage,
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
