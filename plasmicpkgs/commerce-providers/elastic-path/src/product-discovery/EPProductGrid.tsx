/**
 * EPProductGrid — headless repeater that iterates over products.
 *
 * Reads `productGridData.products` from a parent DataProvider (D4) and renders
 * children once per product via `repeatedElement()`. Each iteration exposes
 * `currentProduct` — the same Elastic Path product shape a product page
 * binds — and `currentProductIndex`.
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
import React, { useMemo } from "react";
import { Registerable } from "../registerable";
import { MOCK_PRODUCTS } from "./design-time-data";
import type { Product } from "../types/product";

type PreviewState = "auto" | "withData";

interface EPProductGridProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epProductGridMeta: CodeComponentMeta<EPProductGridProps> = {
  name: "plasmic-commerce-ep-product-grid",
  displayName: "EP Product Grid",
  description:
    "Repeats children for each product in the parent provider's product list. Exposes currentProduct and currentProductIndex for data binding. Works inside EP Product List Provider or EP Related Products Provider.",
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
  const { children, className, previewState = "auto" } = props;

  const gridData = useSelector("productGridData") as
    | { products?: Product[] }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!gridData?.products && inEditor);

  const products = useMemo(() => {
    if (useMock) return MOCK_PRODUCTS;
    return gridData?.products ?? [];
  }, [useMock, gridData?.products]);

  if (products.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Product grid">
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

export function registerEPProductGrid(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductGridProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPProductGrid, customMeta ?? epProductGridMeta);
}
