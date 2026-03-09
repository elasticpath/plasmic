/**
 * EPSearchHits — repeater for catalog search results.
 *
 * Wraps `useHits()` from react-instantsearch and normalizes each hit to
 * the unified `currentProduct` shape used by EPProductGrid (per D2/D4).
 * Designers can reuse the same card layouts across listing and search.
 *
 * Search-specific extras (_highlightedName, _highlightedDescription, _score,
 * rawHit) are also available for advanced use.
 */

import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../registerable";
import { formatCurrency } from "../utils/formatCurrency";
import { MOCK_SEARCH_PRODUCTS } from "./design-time-data";
import type { Product } from "../types/product";

type PreviewState = "auto" | "withData";

interface EPSearchHitsProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

/**
 * Normalize an InstantSearch hit to the unified currentProduct shape.
 * The EP catalog search adapter surfaces various field name conventions;
 * this function tries multiple patterns.
 */
function normalizeHitToCurrentProduct(
  hit: Record<string, any>,
  currencyCode: string
) {
  const name = hit.ep_name || hit.name || hit.attributes?.name || "";
  const slug =
    hit.ep_slug || hit.slug || hit.attributes?.slug || "";
  const sku = hit.ep_sku || hit.sku || hit.attributes?.sku || "";
  const description =
    hit.ep_description ||
    hit.description ||
    hit.attributes?.description ||
    "";

  // Image: try multiple patterns
  const imageUrl =
    hit.ep_main_image_url ||
    hit.main_image_url ||
    hit.main_image?.link?.href ||
    (hit.ep_main_image && hit.ep_main_image.link?.href) ||
    "";

  // Price: try EP catalog search price structure
  const priceObj =
    hit.ep_price?.[currencyCode] ||
    hit.price?.[currencyCode] ||
    hit.ep_price?.USD ||
    hit.price?.USD ||
    null;
  const priceValue =
    priceObj?.float_price ?? priceObj?.amount ?? hit.price?.value ?? 0;
  const priceCurrency = currencyCode || "USD";
  const formatted = formatCurrency(priceValue, priceCurrency);

  // Highlight results from InstantSearch
  const highlighted = hit._highlightResult || hit._highlight || {};

  return {
    id: hit.objectID || hit.id || "",
    name,
    slug,
    sku,
    description,
    path: `/${slug}`,
    images: imageUrl
      ? [{ url: imageUrl, alt: name }]
      : [],
    price: {
      value: priceValue,
      currencyCode: priceCurrency,
      formatted,
    },
    options: [] as Array<{ displayName: string; values: Array<{ label: string }> }>,
    _highlightedName: highlighted.ep_name?.value || highlighted.name?.value || undefined,
    _highlightedDescription:
      highlighted.ep_description?.value ||
      highlighted.description?.value ||
      undefined,
    _score: hit._score ?? hit._rankingInfo?.relevance ?? undefined,
    rawHit: hit,
  };
}

/**
 * Build currentProduct from mock Product (design-time).
 */
function buildMockCurrentProduct(product: Product) {
  const currencyCode = product.price.currencyCode ?? "USD";
  const formatted = formatCurrency(product.price.value, currencyCode);

  return {
    id: product.id,
    name: product.name,
    slug: product.slug ?? "",
    sku: product.sku ?? "",
    description: product.description,
    path: product.path ?? `/${product.slug ?? ""}`,
    images: product.images,
    price: {
      value: product.price.value,
      currencyCode,
      formatted,
    },
    options: product.options.map((opt) => ({
      displayName: opt.displayName,
      values: opt.values.map((v) => ({ label: v.label })),
    })),
    _highlightedName: undefined,
    _highlightedDescription: undefined,
    _score: undefined,
    rawHit: {},
  };
}

export const epSearchHitsMeta: ComponentMeta<EPSearchHitsProps> = {
  name: "plasmic-commerce-ep-search-hits",
  displayName: "EP Search Hits",
  description:
    "Repeats children for each search result. Exposes currentProduct (same shape as EP Product Grid) plus search-specific extras. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "vbox",
          children: [
            {
              type: "text",
              value: "Product Name",
            },
            {
              type: "text",
              value: "$0.00",
            },
          ],
        },
      ],
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
  importName: "EPSearchHits",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
};

export function EPSearchHits(props: EPSearchHitsProps) {
  const { children, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockSearchHits className={className}>{children}</MockSearchHits>
    );
  }

  return (
    <EPSearchHitsInner className={className}>{children}</EPSearchHitsInner>
  );
}

function MockSearchHits(props: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { children, className } = props;

  const products = useMemo(
    () => MOCK_SEARCH_PRODUCTS.map(buildMockCurrentProduct),
    []
  );

  if (products.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Search results">
      {products.map((product, i) => (
        <div key={product.id} role="listitem">
          <DataProvider name="currentProduct" data={product}>
            <DataProvider name="currentProductIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

function EPSearchHitsInner(props: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { children, className } = props;

  const { useHits, useInstantSearch } = require("react-instantsearch");
  const { hits } = useHits();
  const { indexUiState } = useInstantSearch();

  // Read currencyCode from parent EPCatalogSearchProvider's DataProvider context
  const catalogSearchData = useSelector("catalogSearchData") as
    | { currencyCode?: string }
    | undefined;
  const currencyCode = catalogSearchData?.currencyCode || "USD";

  const normalizedProducts = useMemo(
    () =>
      (hits || []).map((hit: Record<string, any>) =>
        normalizeHitToCurrentProduct(hit, currencyCode)
      ),
    [hits, currencyCode]
  );

  if (normalizedProducts.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Search results">
      {normalizedProducts.map(
        (product: ReturnType<typeof normalizeHitToCurrentProduct>, i: number) => (
          <div key={product.id || i} role="listitem">
            <DataProvider name="currentProduct" data={product}>
              <DataProvider name="currentProductIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          </div>
        )
      )}
    </div>
  );
}

export function registerEPSearchHits(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPSearchHitsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchHits, customMeta ?? epSearchHitsMeta);
}
