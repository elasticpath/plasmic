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
import { MOCK_SEARCH_PRODUCTS } from "./design-time-data";
import type { Product } from "../types/product";
import { completePrice } from "../utils/price";

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

const DEFAULT_PRODUCT_PATH_PREFIX = "/product";

interface EPSearchHitsProps {
  children?: React.ReactNode;
  className?: string;
  gridTemplateColumns?: string;
  gridGap?: string;
  productPathPrefix?: string;
  previewState?: PreviewState;
}

/** 1x1 transparent gif — keeps `<img src>` non-empty so the browser issues no
 * self-referential request while the surrounding styles render a placeholder. */
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** What a search hit carries that a product does not. */
export interface SearchHitMeta {
  /** PDP route, built from `productPathPrefix` and the hit's slug or id. */
  path: string;
  highlightedName?: string;
  highlightedDescription?: string;
  snippetedDescription?: string;
  score?: number;
  raw: Record<string, any>;
}

/**
 * A catalog-search hit as an Elastic Path product.
 *
 * The search document already has the shopper-product shape
 * (`{ id, attributes, meta }`), so this fills in the fallbacks for backends
 * that flatten fields onto the hit root and joins the image the adapter
 * inlines — nothing else is reshaped.
 */
function hitToProduct(
  hit: Record<string, any>,
  currencyCode: string
): Product {
  const attributes = {
    ...(hit.attributes ?? {}),
    name: hit.attributes?.name || hit.ep_name || hit.name || "",
    slug: hit.attributes?.slug || hit.ep_slug || hit.slug || "",
    sku: hit.attributes?.sku || hit.ep_sku || hit.sku || "",
    description:
      hit.attributes?.description || hit.ep_description || hit.description || "",
  };

  const imageUrl =
    hit.main_image?.link?.href ||
    hit.ep_main_image?.link?.href ||
    hit.ep_main_image_url ||
    hit.main_image_url ||
    "";

  // EP catalog search reports price in `meta.display_price` when the catalog is
  // configured for it, and otherwise flattens an amount onto the document.
  const displayPrice =
    hit.meta?.display_price?.without_tax || hit.meta?.display_price?.with_tax;
  const flat =
    hit.attributes?.price?.[currencyCode] ||
    hit.attributes?.price?.USD ||
    hit.ep_price?.[currencyCode] ||
    hit.price?.[currencyCode] ||
    hit.ep_price?.USD ||
    hit.price?.USD;
  const price = completePrice(
    displayPrice ?? {
      amount: flat?.amount ?? 0,
      currency: flat?.currency ?? currencyCode,
      float_price: flat?.float_price,
    }
  );

  return {
    id: hit.objectID || hit.id || "",
    type: "product",
    attributes,
    meta: { ...(hit.meta ?? {}), display_price: { without_tax: price } },
    images: [{ url: imageUrl || TRANSPARENT_PIXEL, alt: attributes.name }],
    variations: [],
    childProducts: [],
  };
}

/**
 * The search-side facts about a hit: where it links, and what the backend
 * highlighted.
 *
 * The EP catalog-search backend keys highlights by the BARE `query_by` field
 * names while the document nests them under `attributes.…`, so the adapter's
 * document-driven walk drops them — recover from the raw Typesense hit and keep
 * the adapter paths as fallbacks for backends where they line up.
 */
function hitToSearchMeta(
  hit: Record<string, any>,
  product: Product,
  productPathPrefix: string = DEFAULT_PRODUCT_PATH_PREFIX
): SearchHitMeta {
  const highlighted = hit._highlightResult || hit._highlight || {};
  const snippeted = hit._snippetResult || {};
  const rawHighlight = hit._rawTypesenseHit?.highlight || {};
  const prefix = (productPathPrefix || DEFAULT_PRODUCT_PATH_PREFIX).replace(
    /\/+$/,
    ""
  );

  return {
    path: `${prefix}/${product.attributes?.slug || product.id}`,
    highlightedName:
      rawHighlight.name?.value ||
      rawHighlight.name?.snippet ||
      highlighted.ep_name?.value ||
      highlighted.name?.value ||
      highlighted.attributes?.name?.value ||
      undefined,
    highlightedDescription:
      rawHighlight.description?.value ||
      highlighted.ep_description?.value ||
      highlighted.description?.value ||
      highlighted.attributes?.description?.value ||
      undefined,
    snippetedDescription:
      rawHighlight.description?.snippet ||
      snippeted.description?.value ||
      snippeted.attributes?.description?.value ||
      undefined,
    score: hit._score ?? hit._rankingInfo?.relevance ?? undefined,
    raw: hit,
  };
}

/** Design-time equivalent, so hit cards author against the same shape. */
function mockSearchMeta(
  product: Product,
  productPathPrefix: string = DEFAULT_PRODUCT_PATH_PREFIX
): SearchHitMeta {
  const prefix = (productPathPrefix || DEFAULT_PRODUCT_PATH_PREFIX).replace(
    /\/+$/,
    ""
  );
  return {
    path: `${prefix}/${product.attributes?.slug || product.id}`,
    raw: {},
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
    productPathPrefix: {
      type: "string",
      displayName: "Product Path Prefix",
      description:
        "Route prefix used to build each hit's currentProduct.path link (prefix + '/' + slug). Set this to match the storefront's PDP route, e.g. \"/products\".",
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
    productPathPrefix = DEFAULT_PRODUCT_PATH_PREFIX,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  const gridStyle = buildHitsGridStyle(gridTemplateColumns, gridGap);

  if (useMock) {
    return (
      <MockSearchHits
        className={className}
        gridStyle={gridStyle}
        productPathPrefix={productPathPrefix}
      >
        {children}
      </MockSearchHits>
    );
  }

  return (
    <EPSearchHitsInner
      className={className}
      gridStyle={gridStyle}
      productPathPrefix={productPathPrefix}
    >
      {children}
    </EPSearchHitsInner>
  );
}

function MockSearchHits(props: {
  children?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
  productPathPrefix?: string;
}) {
  const { children, className, gridStyle, productPathPrefix } = props;

  const products = useMemo<
    { product: Product; hit: SearchHitMeta }[]
  >(
    () =>
      MOCK_SEARCH_PRODUCTS.map((p) => ({
        product: p,
        hit: mockSearchMeta(p, productPathPrefix),
      })),
    [productPathPrefix]
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
      {products.map(({ product, hit }, i) => (
        <div key={product.id} role="listitem">
          <DataProvider name="currentProduct" data={product}>
            <DataProvider name="currentHit" data={hit}>
              <DataProvider name="currentProductIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
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
  productPathPrefix?: string;
}) {
  const { children, className, gridStyle, productPathPrefix } = props;

  const { useHits, useInstantSearch } = require("react-instantsearch");
  const { hits } = useHits();
  const { indexUiState } = useInstantSearch();

  // Read currencyCode from parent EPCatalogSearchProvider's DataProvider context
  const catalogSearchData = useSelector("catalogSearchData") as
    | { currencyCode?: string }
    | undefined;
  const currencyCode = catalogSearchData?.currencyCode || "USD";

  const results = useMemo<{ product: Product; hit: SearchHitMeta }[]>(
    () =>
      (hits || []).map((hit: Record<string, any>) => {
        const product = hitToProduct(hit, currencyCode);
        return { product, hit: hitToSearchMeta(hit, product, productPathPrefix) };
      }),
    [hits, currencyCode, productPathPrefix]
  );

  if (results.length === 0) return null;

  return (
    <div
      className={className}
      role="list"
      aria-label="Search results"
      data-ep-search-hits=""
      style={gridStyle}
    >
      {results.map(({ product, hit }, i: number) => (
        <div key={product.id || i} role="listitem">
          <DataProvider name="currentProduct" data={product}>
            <DataProvider name="currentHit" data={hit}>
              <DataProvider name="currentProductIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          </DataProvider>
        </div>
      ))}
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
