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
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../registerable";
import { formatCurrency } from "../utils/formatCurrency";
import { MOCK_SEARCH_PRODUCTS } from "./design-time-data";
import type { Product } from "../types/product";

type PreviewState = "auto" | "withData";

// Default grid layout — applied as inline style so it survives Plasmic's
// className filter (which strips display/grid props from code component
// instances).
//
// `align-self: stretch` keeps the grid full-width when its parent is a flex
// container with `align-items: center` (a common Plasmic page layout).
// Without it the grid collapses to its `min-content` (one column) because
// flex defaults each child to `align-self: auto`.
function buildHitsGridStyle(
  gridTemplateColumns: string,
  gap: string
): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns,
    gap,
    width: "100%",
    alignSelf: "stretch",
  };
}

const DEFAULT_GRID_TEMPLATE_COLUMNS =
  "repeat(auto-fill, minmax(220px, 1fr))";
const DEFAULT_GRID_GAP = "24px";

interface EPSearchHitsProps {
  children?: React.ReactNode;
  className?: string;
  gridTemplateColumns?: string;
  gridGap?: string;
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

  // Image: prefer the inlined `main_image` record that EPCatalogSearchProvider
  // requests via `include: ["main_image"]` (adapter v0.1.0+ resolves the
  // included block against each hit's relationship reference). Fallbacks
  // cover catalogs that already denormalize a URL onto the hit root.
  const imageUrl =
    hit.main_image?.link?.href ||
    hit.ep_main_image?.link?.href ||
    hit.ep_main_image_url ||
    hit.main_image_url ||
    "";

  // 1x1 transparent gif — keeps the <img src> attribute non-empty so the
  // browser doesn't issue a self-referential request (and React's
  // empty-string warning stays silent) while letting the surrounding
  // styles render the visual placeholder.
  const TRANSPARENT_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  // Price resolution — EP catalog search exposes prices in two shapes
  // depending on catalog config:
  //   1. `meta.display_price.without_tax`  → preferred; pre-formatted, currency-aware
  //   2. `attributes.price[CURRENCY].amount` (in cents) → raw fallback
  // We also keep the older `ep_price` / `price` paths for back-compat with
  // search backends that flatten the price object onto the hit root.
  const displayPrice =
    hit.meta?.display_price?.without_tax ||
    hit.meta?.display_price?.with_tax ||
    null;
  const attrPriceObj =
    hit.attributes?.price?.[currencyCode] ||
    hit.attributes?.price?.USD ||
    null;
  const flatPriceObj =
    hit.ep_price?.[currencyCode] ||
    hit.price?.[currencyCode] ||
    hit.ep_price?.USD ||
    hit.price?.USD ||
    null;
  const priceValue =
    displayPrice?.float_price ??
    flatPriceObj?.float_price ??
    flatPriceObj?.amount ??
    (attrPriceObj?.amount != null ? attrPriceObj.amount / 100 : undefined) ??
    hit.price?.value ??
    0;
  const priceCurrency = displayPrice?.currency || currencyCode || "USD";
  const formatted =
    displayPrice?.formatted || formatCurrency(priceValue, priceCurrency);

  // Highlight results from InstantSearch
  const highlighted = hit._highlightResult || hit._highlight || {};

  return {
    id: hit.objectID || hit.id || "",
    name,
    slug,
    sku,
    description,
    // Match the EP ProductDetail page route (`/product/[slug]`).
    // Falls back to id-based URL when the hit lacks a slug.
    path: slug ? `/product/${slug}` : `/product/${hit.objectID || hit.id || ""}`,
    images: [
      {
        url: imageUrl || TRANSPARENT_PIXEL,
        alt: name,
      },
    ],
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

export const epSearchHitsMeta: CodeComponentMeta<EPSearchHitsProps> = {
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
    gridTemplateColumns: {
      type: "string",
      displayName: "Grid Template Columns",
      description:
        "CSS grid-template-columns value applied to the hits container. Defaults to a responsive auto-fill. Plasmic strips display/grid styles set in the canvas Style panel from code components, so this prop is the supported way to override the layout.",
      defaultValue: DEFAULT_GRID_TEMPLATE_COLUMNS,
    },
    gridGap: {
      type: "string",
      displayName: "Grid Gap",
      description: "CSS gap between hit cards.",
      defaultValue: DEFAULT_GRID_GAP,
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
  const {
    children,
    className,
    gridTemplateColumns = DEFAULT_GRID_TEMPLATE_COLUMNS,
    gridGap = DEFAULT_GRID_GAP,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  const gridStyle = buildHitsGridStyle(gridTemplateColumns, gridGap);

  if (useMock) {
    return (
      <MockSearchHits className={className} gridStyle={gridStyle}>
        {children}
      </MockSearchHits>
    );
  }

  return (
    <EPSearchHitsInner className={className} gridStyle={gridStyle}>
      {children}
    </EPSearchHitsInner>
  );
}

function MockSearchHits(props: {
  children?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
}) {
  const { children, className, gridStyle } = props;

  const products = useMemo(
    () => MOCK_SEARCH_PRODUCTS.map(buildMockCurrentProduct),
    []
  );

  if (products.length === 0) return null;

  return (
    <div
      className={className}
      role="list"
      aria-label="Search results"
      data-ep-search-hits=""
      style={gridStyle}
    >
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
  gridStyle: React.CSSProperties;
}) {
  const { children, className, gridStyle } = props;

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
    <div
      className={className}
      role="list"
      aria-label="Search results"
      data-ep-search-hits=""
      style={gridStyle}
    >
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
  customMeta?: CodeComponentMeta<EPSearchHitsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchHits, customMeta ?? epSearchHitsMeta);
}
