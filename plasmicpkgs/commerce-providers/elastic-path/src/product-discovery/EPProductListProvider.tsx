/**
 * EPProductListProvider — headless product listing with pagination and sort.
 *
 * Fetches a single page of products via useProductList and exposes the results
 * plus pagination metadata through a `productGridData` DataProvider key (D4).
 * Supports both pagination mode (replace products per page) and load-more mode
 * (append products from successive pages).
 *
 * Actions (setSort, goToPage, nextPage, prevPage, loadMore) are exposed via
 * refActions so Plasmic interactions can invoke them.
 */

import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Registerable } from "../registerable";
import { useProductList } from "./use-product-list";
import { MOCK_PRODUCT_GRID_DATA, ProductGridData } from "./design-time-data";
import type { Product } from "../types/product";

type PreviewState = "auto" | "withData" | "empty" | "loading" | "error";

interface SeedPage {
  products: Product[];
  totalCount: number;
  pageSize?: number;
}

/**
 * Reads an `ep.getProductPage` envelope off the `initialPage` prop.
 *
 * Studio canvas does not execute server queries — the binding evaluates to an
 * unresolved Promise rather than a page — so anything that is not a settled
 * object carrying a `data` array counts as "no seed" and the provider falls
 * through to its own fetch.
 */
function readSeedPage(value: unknown): SeedPage | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (typeof (value as { then?: unknown }).then === "function") return undefined;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  const meta = (value as { meta?: any }).meta;
  const total = Number(meta?.results?.total);
  const limit = Number(meta?.page?.limit);
  return {
    products: data as Product[],
    totalCount: Number.isFinite(total) ? total : data.length,
    pageSize: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  };
}

interface EPProductListProviderProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  categoryId?: string;
  search?: string;
  initialSort?: string;
  pageSize?: number;
  initialPage?: unknown;
  previewState?: PreviewState;
  className?: string;
}

interface EPProductListProviderActions {
  setSort(value: string): void;
  goToPage(page: number): void;
  nextPage(): void;
  prevPage(): void;
  loadMore(): void;
}

export const epProductListProviderMeta: CodeComponentMeta<EPProductListProviderProps> = {
  name: "plasmic-commerce-ep-product-list-provider",
  displayName: "EP Product List Provider",
  description:
    "Fetches and paginates products from Elastic Path. Exposes productGridData to children for binding. Use EP Product Grid as a child to render products.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-product-grid",
        },
      ],
    },
    loadingContent: {
      type: "slot",
      displayName: "Loading Content",
      defaultValue: { type: "text", value: "Loading products..." },
    },
    errorContent: {
      type: "slot",
      displayName: "Error Content",
      defaultValue: { type: "text", value: "Failed to load products" },
    },
    emptyContent: {
      type: "slot",
      displayName: "Empty Content",
      defaultValue: { type: "text", value: "No products found" },
    },
    categoryId: {
      type: "string",
      displayName: "Category ID",
      description: "Filter products by category ID",
    },
    search: {
      type: "string",
      displayName: "Search",
      description: "Search products by name",
    },
    initialSort: {
      type: "choice",
      options: ["", "price-asc", "price-desc", "latest-desc", "trending-desc"],
      displayName: "Sort",
      description: "Initial sort order for products",
    },
    pageSize: {
      type: "number",
      displayName: "Page Size",
      description: "Number of products per page",
      defaultValue: 12,
    },
    initialPage: {
      type: "object",
      displayName: "Products (pre-fetched)",
      description:
        "Bind to an ep.getProductPage Server Query result (e.g. $q.plp.data) to server-render the first page instead of fetching it in the browser. The query's page[limit] wins over Page Size. Sorting or paging discards it and falls back to client fetching. Leave empty to fetch client-side.",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData", "empty", "loading", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPProductListProvider",
  providesData: true,
  refActions: {
    setSort: {
      description: "Change the sort order and reset to page 0",
      argTypes: [{ name: "value", type: "string" }],
    },
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
    loadMore: {
      description: "Append the next page of products (load-more mode)",
      argTypes: [],
    },
  },
};

export const EPProductListProvider = React.forwardRef<
  EPProductListProviderActions,
  EPProductListProviderProps
>(function EPProductListProvider(props, ref) {
  const {
    children,
    loadingContent,
    errorContent,
    emptyContent,
    categoryId,
    search,
    initialSort = "",
    pageSize = 12,
    initialPage,
    previewState = "auto",
    className,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // --- Design-time preview handling ---
  if (inEditor) {
    if (previewState === "loading") {
      return (
        <div className={className} data-ep-product-list-provider="">
          {loadingContent}
        </div>
      );
    }
    if (previewState === "error") {
      return (
        <div className={className} data-ep-product-list-provider="">
          {errorContent}
        </div>
      );
    }
    if (previewState === "empty") {
      return (
        <DataProvider
          name="productGridData"
          data={{
            ...MOCK_PRODUCT_GRID_DATA,
            products: [],
            totalCount: 0,
            isEmpty: true,
            summary: "No products found",
          }}
        >
          <div className={className} data-ep-product-list-provider="">
            {emptyContent}
          </div>
        </DataProvider>
      );
    }
  }

  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockProductListProvider ref={ref} className={className}>
        {children}
      </MockProductListProvider>
    );
  }

  return (
    <EPProductListProviderInner
      ref={ref}
      categoryId={categoryId}
      search={search}
      initialSort={initialSort}
      pageSize={pageSize}
      initialPage={initialPage}
      className={className}
      loadingContent={loadingContent}
      errorContent={errorContent}
      emptyContent={emptyContent}
    >
      {children}
    </EPProductListProviderInner>
  );
});

// Mock provider for design-time — actions are no-ops
const MockProductListProvider = React.forwardRef<
  EPProductListProviderActions,
  { children?: React.ReactNode; className?: string }
>(function MockProductListProvider({ children, className }, ref) {
  useImperativeHandle(ref, () => ({
    setSort: () => {},
    goToPage: () => {},
    nextPage: () => {},
    prevPage: () => {},
    loadMore: () => {},
  }));

  return (
    <DataProvider name="productGridData" data={MOCK_PRODUCT_GRID_DATA}>
      <div className={className} data-ep-product-list-provider="">
        {children}
      </div>
    </DataProvider>
  );
});

// Inner component to avoid calling hooks conditionally in preview branches.
// All hooks are called unconditionally here.
const EPProductListProviderInner = React.forwardRef<
  EPProductListProviderActions,
  {
    children?: React.ReactNode;
    categoryId?: string;
    search?: string;
    initialSort?: string;
    pageSize?: number;
    initialPage?: unknown;
    className?: string;
    loadingContent?: React.ReactNode;
    errorContent?: React.ReactNode;
    emptyContent?: React.ReactNode;
  }
>(function EPProductListProviderInner(props, ref) {
  const {
    children,
    categoryId,
    search,
    initialSort = "",
    pageSize = 12,
    initialPage,
    className,
    loadingContent,
    errorContent,
    emptyContent,
  } = props;

  const [currentPage, setCurrentPage] = useState(0);
  const [sort, setSort] = useState(initialSort);
  const [isLoadMoreMode, setIsLoadMoreMode] = useState(false);
  const [loadMoreProducts, setLoadMoreProducts] = useState<Product[]>([]);
  // Track the last page whose products were appended to avoid double-appending
  const lastAppendedPageRef = useRef(-1);

  const seed = useMemo(() => readSeedPage(initialPage), [initialPage]);
  const [seedDismissed, setSeedDismissed] = useState(false);
  // The seed is page 0 at `initialSort`. Any sort or page change makes it
  // stale, so it is dropped for good rather than resurrected on a return to
  // page 0 — SWR already makes that re-fetch cheap, and reviving it would
  // show SSR-era data after a mutation elsewhere in the session.
  const seedActive = !!seed && !seedDismissed;
  const dismissSeed = useCallback(() => setSeedDismissed(true), []);
  // A seed fetched with its own page[limit] defines the page boundaries; a
  // mismatched Page Size prop would otherwise make every range and total wrong.
  const effectivePageSize = seed?.pageSize ?? pageSize;

  const {
    products: fetchedProducts,
    totalCount: fetchedTotalCount,
    isLoading,
    error,
  } = useProductList({
    categoryId,
    search,
    sort,
    page: currentPage,
    pageSize: effectivePageSize,
    skip: seedActive,
  });

  const products = seedActive ? seed!.products : fetchedProducts;
  const totalCount = seedActive ? seed!.totalCount : fetchedTotalCount;

  const totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize));
  const hasNextPage = currentPage < totalPages - 1;
  const hasPreviousPage = currentPage > 0;

  // Append products in load-more mode when a new page arrives
  useEffect(() => {
    if (
      !seedActive &&
      isLoadMoreMode &&
      !isLoading &&
      products.length > 0 &&
      currentPage !== lastAppendedPageRef.current
    ) {
      lastAppendedPageRef.current = currentPage;
      setLoadMoreProducts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newProducts = products.filter((p) => !existingIds.has(p.id));
        return newProducts.length > 0 ? [...prev, ...newProducts] : prev;
      });
    }
  }, [seedActive, isLoadMoreMode, isLoading, products, currentPage]);

  const displayProducts =
    isLoadMoreMode && loadMoreProducts.length > 0
      ? loadMoreProducts
      : products;

  const isEmpty =
    !isLoading && displayProducts.length === 0 && totalCount === 0;

  const rangeStart =
    totalCount === 0 ? 0 : currentPage * effectivePageSize + 1;
  const rangeEnd = Math.min(
    (currentPage + 1) * effectivePageSize,
    totalCount
  );
  const displayCount = isLoadMoreMode ? loadMoreProducts.length : displayProducts.length;
  const summary = isEmpty
    ? "No products found"
    : isLoadMoreMode
    ? `Showing ${displayCount} of ${totalCount} products`
    : `Showing ${rangeStart}-${rangeEnd} of ${totalCount} products`;

  const productGridData: ProductGridData = useMemo(
    () => ({
      products: displayProducts,
      totalCount,
      currentPage,
      totalPages,
      pageSize: effectivePageSize,
      sort,
      isLoading,
      hasNextPage,
      hasPreviousPage,
      isEmpty,
      rangeStart,
      rangeEnd,
      summary,
    }),
    [
      displayProducts,
      totalCount,
      currentPage,
      totalPages,
      effectivePageSize,
      sort,
      isLoading,
      hasNextPage,
      hasPreviousPage,
      isEmpty,
      rangeStart,
      rangeEnd,
      summary,
    ]
  );

  // --- Actions for refActions ---

  const resetLoadMore = useCallback(() => {
    setIsLoadMoreMode(false);
    setLoadMoreProducts([]);
    lastAppendedPageRef.current = -1;
  }, []);

  const handleSetSort = useCallback(
    (value: string) => {
      setSort(value);
      setCurrentPage(0);
      dismissSeed();
      resetLoadMore();
    },
    [dismissSeed, resetLoadMore]
  );

  const handleGoToPage = useCallback(
    (page: number) => {
      const safePage = Math.max(0, Math.min(page, totalPages - 1));
      setCurrentPage(safePage);
      dismissSeed();
      resetLoadMore();
    },
    [totalPages, dismissSeed, resetLoadMore]
  );

  const handleNextPage = useCallback(() => {
    if (hasNextPage) {
      setCurrentPage((p) => p + 1);
      dismissSeed();
      if (!isLoadMoreMode) {
        resetLoadMore();
      }
    }
  }, [hasNextPage, isLoadMoreMode, dismissSeed, resetLoadMore]);

  const handlePrevPage = useCallback(() => {
    if (hasPreviousPage) {
      setCurrentPage((p) => p - 1);
      dismissSeed();
      resetLoadMore();
    }
  }, [hasPreviousPage, dismissSeed, resetLoadMore]);

  const handleLoadMore = useCallback(() => {
    if (!hasNextPage) return;
    if (!isLoadMoreMode) {
      // First loadMore: enter load-more mode, seed with current products.
      // With a server-rendered seed those ARE the current products — without
      // this the grid would flash back to a client-fetched page 0.
      setIsLoadMoreMode(true);
      setLoadMoreProducts([...products]);
      lastAppendedPageRef.current = currentPage;
    }
    dismissSeed();
    setCurrentPage((p) => p + 1);
  }, [hasNextPage, isLoadMoreMode, products, currentPage, dismissSeed]);

  useImperativeHandle(ref, () => ({
    setSort: handleSetSort,
    goToPage: handleGoToPage,
    nextPage: handleNextPage,
    prevPage: handlePrevPage,
    loadMore: handleLoadMore,
  }));

  // Show loading/error/empty states
  if (isLoading && displayProducts.length === 0) {
    return (
      <DataProvider name="productGridData" data={productGridData}>
        <div className={className} data-ep-product-list-provider="">
          {loadingContent}
        </div>
      </DataProvider>
    );
  }

  if (error && displayProducts.length === 0) {
    return (
      <DataProvider name="productGridData" data={productGridData}>
        <div className={className} data-ep-product-list-provider="">
          {errorContent}
        </div>
      </DataProvider>
    );
  }

  if (isEmpty) {
    return (
      <DataProvider name="productGridData" data={productGridData}>
        <div className={className} data-ep-product-list-provider="">
          {emptyContent}
        </div>
      </DataProvider>
    );
  }

  return (
    <DataProvider name="productGridData" data={productGridData}>
      <div className={className} data-ep-product-list-provider="">
        {children}
      </div>
    </DataProvider>
  );
});

export function registerEPProductListProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductListProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductListProvider,
    customMeta ?? epProductListProviderMeta
  );
}
