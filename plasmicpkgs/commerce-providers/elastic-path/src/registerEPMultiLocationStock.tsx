import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import type { Product } from "./types/product";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "./const";
import { MultiLocationStock } from "./inventory/components/MultiLocationStock";
import { Registerable } from "./registerable";
import type { MultiLocationStockProps } from "./inventory/types";

interface EPMultiLocationStockProps extends Omit<MultiLocationStockProps, 'productId'> {
  // No productId needed as it comes from product context
}

/**
 * Deprecated. Kept registered only so the hostless publish keeps working: a
 * component that disappears from a hostless package's registered set makes
 * `publish-hostless` fail outright, so retiring one means deprecating it here
 * rather than deleting it.
 *
 * It cannot be styled — no className, no slots — and it clears the shared
 * SelectedLocationSlug field on mount, so placing it beside EPStockProvider can
 * wipe a location the shopper picked. EPStockProvider with EPLocationPicker and
 * EPLocationField replaces it and is fully designable.
 */
export const epMultiLocationStockMeta: CodeComponentMeta<EPMultiLocationStockProps> = {
  name: "plasmic-commerce-ep-multi-location-stock",
  displayName: "EP Multi-Location Stock (deprecated)",
  description:
    "Deprecated — do not use. Replace with EP Stock Provider plus EP Location Picker and EP Location Field, which are designable and support a dropdown mode and ?location= URL syncing.",
  hideFromContentCreators: true,
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
      defaultValue: DEFAULT_LOW_STOCK_THRESHOLD,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
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
  customEPMultiLocationStockMeta?: CodeComponentMeta<EPMultiLocationStockProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPMultiLocationStock,
    customEPMultiLocationStockMeta ?? epMultiLocationStockMeta
  );
}