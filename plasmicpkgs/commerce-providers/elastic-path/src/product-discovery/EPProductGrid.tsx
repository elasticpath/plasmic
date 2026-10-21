/**
 * EPProductGrid — headless repeater that iterates over products.
 *
 * Reads `productGridData.products` from a parent DataProvider (D4) and renders
 * children once per product via `repeatedElement()`. Each iteration exposes
 * `currentProduct`, `currentHit.path` and `currentProductIndex`.
 *
 * No `parentComponentName` restriction (D5) — works inside both
 * EPProductListProvider and EPRelatedProductsProvider.
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
import React, { useContext, useEffect, useMemo, useRef } from "react";
import { Registerable } from "../registerable";
import { MOCK_PRODUCTS } from "./design-time-data";
import { ListingSourceContext } from "./listing-source";
import type { Product } from "../types/product";
import {
  DEFAULT_PRODUCT_PATH_PREFIX,
  PRODUCT_PATH_PREFIX_PROP,
  productHitMeta,
} from "../utils/product-path";

type PreviewState = "auto" | "withData";

interface EPProductGridProps {
  children?: React.ReactNode;
  className?: string;
  productPathPrefix?: string;
  previewState?: PreviewState;
}

export const epProductGridMeta: CodeComponentMeta<EPProductGridProps> = {
  name: "plasmic-commerce-ep-product-grid",
  displayName: "EP Product Grid",
  description:
    "Repeats children for each product in the parent provider's product list. Exposes currentProduct, currentHit.path (the product page link, as EP Search Hits publishes it) and currentProductIndex for data binding. Works inside EP Product List Provider or EP Related Products Provider. Inside EP Catalog Search Provider, use EP Search Hits or EP Search Infinite Hits instead.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "vbox",
          children: [
            {
              type: "component",
              name: "plasmic-commerce-ep-product-field",
              props: { field: "firstImageUrl", show: "image" },
              styles: { width: "100%" },
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-product-field",
              props: { field: "name" },
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-product-field",
              props: { field: "price" },
            },
          ],
        },
      ],
    },
    productPathPrefix: PRODUCT_PATH_PREFIX_PROP,
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Studio only. `withData` shows sample products on the canvas. Published pages always show the provider's products.",
      advanced: true,
    },
  } as any,
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPProductGrid",
  providesData: true,
};

export function EPProductGrid(props: EPProductGridProps) {
  const {
    children,
    className,
    productPathPrefix = DEFAULT_PRODUCT_PATH_PREFIX,
    previewState = "auto",
  } = props;

  const gridData = useSelector("productGridData") as
    | { products?: Product[] }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const inCatalogSearch =
    useContext(ListingSourceContext) === "catalog-search";
  useWarnInCatalogSearch(inCatalogSearch);

  const useMock =
    inEditor && (previewState === "withData" || !gridData?.products);

  const products = useMemo(() => {
    if (useMock) return MOCK_PRODUCTS;
    return gridData?.products ?? [];
  }, [useMock, gridData?.products]);

  if (inCatalogSearch) {
    return inEditor ? (
      <div className={className} data-ep-product-grid-notice="">
        {PRODUCT_GRID_IN_CATALOG_SEARCH}
      </div>
    ) : null;
  }

  if (products.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Product grid">
      {products.map((product, i) => (
        <div key={product.id} role="listitem">
          <DataProvider name="currentProduct" data={product}>
            <DataProvider
              name="currentHit"
              data={productHitMeta(product, productPathPrefix)}
            >
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

const PRODUCT_GRID_IN_CATALOG_SEARCH =
  "EP Product Grid is inside EP Catalog Search Provider, which does not " +
  "supply the grid's products. Use EP Search Hits or EP Search Infinite " +
  "Hits to list search results, or move the grid into EP Product List " +
  "Provider or EP Related Products Provider.";

function useWarnInCatalogSearch(inCatalogSearch: boolean) {
  const warned = useRef(false);
  useEffect(() => {
    if (!inCatalogSearch || warned.current) return;
    warned.current = true;
    console.warn(`[ep-commerce] ${PRODUCT_GRID_IN_CATALOG_SEARCH}`);
  }, [inCatalogSearch]);
}

export function registerEPProductGrid(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductGridProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPProductGrid, customMeta ?? epProductGridMeta);
}
