/**
 * EPProductGrid — headless repeater that iterates over products.
 *
 * Reads `productGridData.products` from a parent DataProvider (D4) and renders
 * children once per product via `repeatedElement()`. Each iteration exposes
 * `currentProduct` (with `price.formatted` per D2) and `currentProductIndex`.
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
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../registerable";
import { formatCurrency } from "../utils/formatCurrency";
import { MOCK_PRODUCTS } from "./design-time-data";
import type { Product } from "../types/product";

type PreviewState = "auto" | "withData";

interface EPProductGridProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export interface CurrentProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  path: string;
  images: Array<{ url: string; alt?: string }>;
  price: {
    value: number;
    currencyCode: string;
    formatted: string;
  };
  options: Array<{ displayName: string; values: Array<{ label: string }> }>;
  rawData?: unknown;
}

export function buildCurrentProduct(product: Product): CurrentProduct {
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
    rawData: (product as any).rawData,
  };
}

export const epProductGridMeta: ComponentMeta<EPProductGridProps> = {
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
      {products.map((product, i) => {
        const currentProduct = buildCurrentProduct(product);
        return (
          <div key={product.id} role="listitem">
            <DataProvider name="currentProduct" data={currentProduct}>
              <DataProvider name="currentProductIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          </div>
        );
      })}
    </div>
  );
}

export function registerEPProductGrid(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPProductGridProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPProductGrid, customMeta ?? epProductGridMeta);
}
