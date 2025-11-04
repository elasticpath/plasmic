import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Product } from "@plasmicpkgs/commerce";
import { MultiLocationStock } from "./inventory/components/MultiLocationStock";
import { Registerable } from "./registerable";
import type { MultiLocationStockProps } from "./inventory/types";

interface EPMultiLocationStockProps extends Omit<MultiLocationStockProps, 'productId'> {
  // No productId needed as it comes from product context
}

export const epMultiLocationStockMeta: ComponentMeta<EPMultiLocationStockProps> = {
  name: "plasmic-commerce-ep-multi-location-stock",
  displayName: "EP Multi-Location Stock",
  description: "Display stock levels across multiple locations for Elastic Path products",
  props: {
    showLocationSelector: {
      type: "boolean",
      displayName: "Show Location Selector",
      description: "Display a dropdown to filter by specific location",
      defaultValue: true,
    },
    maxLocationsDisplay: {
      type: "number",
      displayName: "Max Locations Display",
      description: "Maximum number of locations to display before truncation",
      defaultValue: 5,
    },
    showStockNumbers: {
      type: "boolean",
      displayName: "Show Stock Numbers",
      description: "Display exact stock numbers instead of just indicators",
      defaultValue: true,
    },
    lowStockThreshold: {
      type: "number",
      displayName: "Low Stock Threshold",
      description: "Stock level below which items are considered low stock",
      defaultValue: 5,
    },
  },
  importPath: "@plasmicpkgs/commerce",
  importName: "EPMultiLocationStock",
};

export function EPMultiLocationStock(props: EPMultiLocationStockProps) {
  const product = useSelector("currentProduct") as Product | undefined;

  return (
    <MultiLocationStock
      productId={product?.id}
      {...props}
    />
  );
}

export function registerEPMultiLocationStock(
  loader?: Registerable,
  customEPMultiLocationStockMeta?: ComponentMeta<EPMultiLocationStockProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPMultiLocationStock,
    customEPMultiLocationStockMeta ?? epMultiLocationStockMeta
  );
}