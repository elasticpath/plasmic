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
import { productHitMeta } from "../utils/product-path";
import { useHits } from "react-instantsearch";
import {
  HITS_CARD_SLOT,
  HitsGridLayoutProps,
  HitsGridProps,
  hitsGridMetaProps,
  useHitsGrid,
} from "./hits-grid";
import { hitToProduct, hitToSearchMeta } from "./search-hit";
import type { SearchHitMeta } from "./search-hit";

interface EPSearchHitsProps extends HitsGridLayoutProps {
  children?: React.ReactNode;
  className?: string;
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
