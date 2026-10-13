/**
 * EPProductGrid — headless repeater that iterates over products.
 *
 * Reads `productGridData.products` from a parent DataProvider (D4) and renders
 * children once per product via `repeatedElement()`. Each iteration exposes
 * `currentProduct` — the same Elastic Path product shape a product page
 * binds — `currentHit.path`, its product page link built exactly as
 * EPSearchHits builds it, and `currentProductIndex`.
 *
 * No `parentComponentName` restriction (D5) — works inside both
 * EPProductListProvider and EPRelatedProductsProvider. Inside
 * EPCatalogSearchProvider, which supplies no `productGridData`, it warns once
 * per mount and shows the mismatch on the Studio canvas.
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
  productPath,
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
    productPathPrefix: PRODUCT_PATH_PREFIX_PROP,
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
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
    previewState === "withData" || (!gridData?.products && inEditor);

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
              data={{ path: productPath(product, productPathPrefix), raw: {} }}
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
