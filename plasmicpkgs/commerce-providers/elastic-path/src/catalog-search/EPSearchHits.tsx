/**
 * EPSearchHits — repeater for catalog search results.
 *
 * Wraps `useHits()` from react-instantsearch and normalizes each hit to
 * the `currentProduct` shape EPProductGrid publishes (per D2/D4), with the
 * same `currentHit.path` link. Designers can reuse the same card layouts
 * across listing and search.
 *
 * Search-specific extras on `currentHit` (highlightedName,
 * highlightedDescription, score, raw) are also available for advanced use.
 */

import { DataProvider, repeatedElement, useSelector } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../registerable";
import { MOCK_SEARCH_PRODUCTS } from "./design-time-data";
import type { Product } from "../types/product";
import { completePrice } from "../utils/price";
import {
  DEFAULT_PRODUCT_PATH_PREFIX,
  productHitMeta,
  productPath,
} from "../utils/product-path";
import { useHits } from "react-instantsearch";
import {
  HITS_CARD_SLOT,
  HitsGridLayoutProps,
  HitsGridProps,
  hitsGridMetaProps,
  useHitsGrid,
} from "./hits-grid";

interface EPSearchHitsProps extends HitsGridLayoutProps {
  children?: React.ReactNode;
  className?: string;
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
export function hitToProduct(
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

  return {
    path: productPath(product, productPathPrefix),
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

export const epSearchHitsMeta: CodeComponentMeta<EPSearchHitsProps> = {
  name: "plasmic-commerce-ep-search-hits",
  displayName: "EP Search Hits",
  description:
    "Repeats children for each search result. Exposes currentProduct and currentHit.path (same as EP Product Grid) plus search-specific extras. Must be inside EP Catalog Search Provider.",
  props: {
    children: HITS_CARD_SLOT,
    ...hitsGridMetaProps(
      "CSS grid-template-columns value applied to the hits container. Defaults to a responsive auto-fill. Plasmic strips display/grid styles set in the canvas Style panel from code components, so this prop is the supported way to override the layout."
    ),
  } as any,
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPSearchHits",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
};

export function EPSearchHits(props: EPSearchHitsProps) {
  const { children, className } = props;
  const { useMock, gridStyle, productPathPrefix } = useHitsGrid(props);
  const Grid = useMock ? MockSearchHits : EPSearchHitsInner;

  return (
    <Grid
      className={className}
      gridStyle={gridStyle}
      productPathPrefix={productPathPrefix}
    >
      {children}
    </Grid>
  );
}

export function MockSearchHits(props: HitsGridProps) {
  const { children, className, gridStyle, productPathPrefix } = props;

  const products = useMemo<{ product: Product; hit: SearchHitMeta }[]>(
    () =>
      MOCK_SEARCH_PRODUCTS.map((p) => ({
        product: p,
        hit: productHitMeta(p, productPathPrefix),
      })),
    [productPathPrefix]
  );

  return (
    <HitsList className={className} gridStyle={gridStyle} results={products}>
      {children}
    </HitsList>
  );
}

function EPSearchHitsInner(props: HitsGridProps) {
  const { hits } = useHits();

  return <SearchHitsGrid {...props} hits={hits} />;
}

export function SearchHitsGrid(
  props: HitsGridProps & { hits: Record<string, any>[] }
) {
  const { hits, children, className, gridStyle, productPathPrefix } = props;

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

  return (
    <HitsList className={className} gridStyle={gridStyle} results={results}>
      {children}
    </HitsList>
  );
}

function HitsList(props: {
  results: { product: Product; hit: SearchHitMeta }[];
  children?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
}) {
  const { results, children, className, gridStyle } = props;

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
