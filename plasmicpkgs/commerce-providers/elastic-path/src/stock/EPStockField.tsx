import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_PRODUCT_STOCK } from "../utils/design-time-data";
import type { ProductStockSummary } from "./StockContext";

type StockFieldName = keyof Pick<
  ProductStockSummary,
  "totalAvailable" | "totalAllocated" | "locationCount"
>;

type StockFieldValue = StockFieldName | "stockStatus";

type PreviewState = "auto" | "withData";

interface EPStockFieldProps {
  field: StockFieldValue;
  className?: string;
  previewState?: PreviewState;
}

export const epStockFieldMeta: ComponentMeta<EPStockFieldProps> = {
  name: "plasmic-commerce-ep-stock-field",
  displayName: "EP Stock Field",
  description:
    "Displays a product stock summary field. Must be inside an EP Stock Provider.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Total Available", value: "totalAvailable" },
        { label: "Total Allocated", value: "totalAllocated" },
        { label: "Location Count", value: "locationCount" },
        { label: "Stock Status", value: "stockStatus" },
      ],
      defaultValue: "totalAvailable",
      displayName: "Field",
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
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPStockField",
};

export function EPStockField(props: EPStockFieldProps) {
  const { field = "totalAvailable", className, previewState = "auto" } = props;

  const productStock = useSelector("productStock") as
    | ProductStockSummary
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && !productStock && inEditor);
  const effectiveStock = useMock ? MOCK_PRODUCT_STOCK : productStock;

  if (!effectiveStock) {
    return <span className={className}>—</span>;
  }

  let value: string;
  if (field === "stockStatus") {
    value = effectiveStock.isLowStock
      ? "Low Stock"
      : effectiveStock.isInStock
        ? "In Stock"
        : "Out of Stock";
  } else {
    value = String(effectiveStock[field] ?? "");
  }

  return <span className={className}>{value}</span>;
}

export function registerEPStockField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPStockFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPStockField, customMeta ?? epStockFieldMeta);
}
