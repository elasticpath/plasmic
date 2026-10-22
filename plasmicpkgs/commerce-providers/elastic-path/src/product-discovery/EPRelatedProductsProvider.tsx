/**
 * EPRelatedProductsProvider — headless provider for related products.
 *
 * Fetches products related to a given product via EP Custom Relationships API
 * (e.g., "CRP_related_products", "CRP_upsell", "CRP_accessories").
 *
 * Reads the current product ID from parent DataProvider context
 * (`useSelector("currentProduct")`) if `productId` prop is not provided.
 *
 * Writes to `productGridData` DataProvider key (D4) so EPProductGrid from
 * Phase 1 can be reused as a child without modification (D5). Also provides
 * `relatedProductsData` with relationship-specific metadata.
 */

import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { listContent } from "./list-content";
import { ListingSourceContext } from "./listing-source";
import { useRelatedProducts } from "./use-related-products";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { SAMPLE_PRODUCT_ID } from "../utils/design-time-data";
import {
  MOCK_RELATED_PRODUCTS_DATA,
  MOCK_RELATED_PRODUCT_GRID_DATA,
} from "./design-time-data";
import type { ProductGridData } from "./design-time-data";
import type { Product } from "../types/product";

type PreviewState = "auto" | "withData" | "empty" | "loading" | "error";

interface EPRelatedProductsProviderProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  relationshipSlug?: string;
  relationshipName?: string;
  productId?: string;
  limit?: number;
  previewState?: PreviewState;
  className?: string;
}

export interface RelatedProductsData {
  products: Product[];
  totalCount: number;
  relationshipSlug: string;
  relationshipName: string;
  isLoading: boolean;
  isEmpty: boolean;
}

export const epRelatedProductsProviderMeta: CodeComponentMeta<EPRelatedProductsProviderProps> =
  {
    name: "plasmic-commerce-ep-related-products-provider",
    displayName: "EP Related Products Provider",
    description:
      "Fetches related products via EP Custom Relationships API. Exposes productGridData so EP Product Grid can render them. Set relationshipSlug to match your EP relationship (e.g. CRP_related_products, CRP_upsell).",
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
        defaultValue: { type: "text", value: "Loading related products..." },
      },
      errorContent: {
        type: "slot",
        displayName: "Error Content",
        defaultValue: {
          type: "text",
          value: "Failed to load related products",
        },
      },
      emptyContent: {
        type: "slot",
        displayName: "Empty Content",
        defaultValue: { type: "text", value: "No related products found" },
      },
      relationshipSlug: {
        type: "string",
        displayName: "Relationship Slug",
        description:
          "Custom relationship slug defined in EP Commerce Manager (e.g. CRP_related_products, CRP_upsell, CRP_accessories)",
        defaultValue: "CRP_related_products",
      },
      relationshipName: {
        type: "string",
        displayName: "Relationship Name",
        description:
          "Human-readable name for the relationship (e.g. Related Products, You May Also Like, Accessories). Exposed via relatedProductsData for section headings.",
        defaultValue: "Related Products",
      },
      productId: {
        type: "string",
        displayName: "Product ID",
        description:
          "Override product ID. If empty, reads from parent currentProduct context (e.g. PDP page).",
      },
      limit: {
        type: "number",
        displayName: "Limit",
        description: "Maximum number of related products to fetch",
        defaultValue: 4,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "empty", "loading", "error"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Studio only. `auto` shows the store's related products, and labelled sample products when the read fails. With no product to look up, it shows sample products. The other values force a state on the canvas. Published pages always fetch.",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPRelatedProductsProvider",
    providesData: true,
  };

export function EPRelatedProductsProvider(
  props: EPRelatedProductsProviderProps
) {
  return (
    <ListingSourceContext.Provider value="product-grid-data">
      <EPRelatedProductsProviderContent {...props} />
    </ListingSourceContext.Provider>
  );
}

function EPRelatedProductsProviderContent(
  props: EPRelatedProductsProviderProps
) {
  const {
    children,
    loadingContent,
    errorContent,
    emptyContent,
    relationshipSlug = "CRP_related_products",
    relationshipName = "Related Products",
    productId: productIdProp,
    limit = 4,
    previewState = "auto",
    className,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const hasStore = !!useEpCommerce();

  // Read product ID from parent context if not provided as prop
  const currentProduct = useSelector("currentProduct") as
    | { id?: string }
    | undefined;
  const productId = productIdProp || currentProduct?.id;

  // --- Design-time preview handling ---
  if (inEditor) {
    if (previewState === "loading") {
      return (
        <div className={className} data-ep-related-products-provider="">
          {loadingContent}
        </div>
      );
    }
    if (previewState === "error") {
      return (
        <div className={className} data-ep-related-products-provider="">
          {errorContent}
        </div>
      );
    }
    if (previewState === "empty") {
      const emptyGridData: ProductGridData = {
        ...MOCK_RELATED_PRODUCT_GRID_DATA,
        products: [],
        totalCount: 0,
        isEmpty: true,
        summary: "No related products found",
      };
      const emptyRelatedData: RelatedProductsData = {
        products: [],
        totalCount: 0,
        relationshipSlug,
        relationshipName,
        isLoading: false,
        isEmpty: true,
      };
      return (
        <DataProvider name="productGridData" data={emptyGridData}>
          <DataProvider name="relatedProductsData" data={emptyRelatedData}>
            <div className={className} data-ep-related-products-provider="">
              {emptyContent}
            </div>
          </DataProvider>
        </DataProvider>
      );
    }
  }

  const nothingToLookUp = !productId || productId === SAMPLE_PRODUCT_ID;
  if (
    inEditor &&
    (previewState === "withData" || !hasStore || nothingToLookUp)
  ) {
    return (
      <DataProvider
        name="productGridData"
        data={MOCK_RELATED_PRODUCT_GRID_DATA}
      >
        <DataProvider
          name="relatedProductsData"
          data={MOCK_RELATED_PRODUCTS_DATA}
        >
          <div className={className} data-ep-related-products-provider="">
            {children}
          </div>
        </DataProvider>
      </DataProvider>
    );
  }

  return (
    <EPRelatedProductsProviderInner
      productId={productId}
      relationshipSlug={relationshipSlug}
      relationshipName={relationshipName}
      limit={limit}
      className={className}
      loadingContent={loadingContent}
      errorContent={errorContent}
      emptyContent={emptyContent}
      sampleOnError={inEditor}
    >
      {children}
    </EPRelatedProductsProviderInner>
  );
}

// Inner component to avoid calling hooks conditionally in preview branches.
function EPRelatedProductsProviderInner(props: {
  children?: React.ReactNode;
  productId?: string;
  relationshipSlug: string;
  relationshipName: string;
  limit: number;
  className?: string;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  sampleOnError?: boolean;
}) {
  const {
    children,
    productId,
    relationshipSlug,
    relationshipName,
    limit,
    className,
    loadingContent,
    errorContent,
    emptyContent,
    sampleOnError,
  } = props;

  const { products, totalCount, isLoading, error } = useRelatedProducts({
    productId,
    relationshipSlug,
    limit,
  });

  const isEmpty = !isLoading && products.length === 0 && totalCount === 0;

  const productGridData: ProductGridData = {
    products,
    totalCount,
    currentPage: 0,
    totalPages: 1,
    pageSize: limit,
    isLoading,
    hasNextPage: false,
    hasPreviousPage: false,
    isEmpty,
    rangeStart: totalCount === 0 ? 0 : 1,
    rangeEnd: products.length,
    summary: isEmpty
      ? "No related products found"
      : `Showing ${products.length} related product${products.length === 1 ? "" : "s"}`,
  };

  const relatedProductsData: RelatedProductsData = {
    products,
    totalCount,
    relationshipSlug,
    relationshipName,
    isLoading,
    isEmpty,
  };

  const { content, showSample } = listContent({
    isLoading,
    productCount: products.length,
    error,
    sampleOnError,
    isEmpty,
    children,
    loadingContent,
    errorContent,
    emptyContent,
  });

  return (
    <DataProvider
      name="productGridData"
      data={showSample ? MOCK_RELATED_PRODUCT_GRID_DATA : productGridData}
    >
      <DataProvider
        name="relatedProductsData"
        data={showSample ? MOCK_RELATED_PRODUCTS_DATA : relatedProductsData}
      >
        <div className={className} data-ep-related-products-provider="">
          {content}
        </div>
      </DataProvider>
    </DataProvider>
  );
}

export function registerEPRelatedProductsProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPRelatedProductsProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPRelatedProductsProvider,
    customMeta ?? epRelatedProductsProviderMeta
  );
}
