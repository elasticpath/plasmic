import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_STOCK_LOCATIONS } from "../utils/design-time-data";
import type { StockLocationData } from "./StockContext";

type LocationFieldName = keyof Pick<
  StockLocationData,
  "name" | "available" | "allocated" | "total" | "stockStatus"
>;

type PreviewState = "auto" | "inStock" | "lowStock" | "outOfStock";

interface EPLocationFieldProps {
  field: LocationFieldName;
  className?: string;
  previewState?: PreviewState;
}

const PREVIEW_LOCATION_INDEX: Record<string, number> = {
  inStock: 0,
  lowStock: 1,
  outOfStock: 2,
};

export const epLocationFieldMeta: ComponentMeta<EPLocationFieldProps> = {
  name: "plasmic-commerce-ep-location-field",
  displayName: "EP Location Field",
  description:
    "Displays a field from the current stock location. Must be inside an EP Stock Provider or EP Location Picker.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Name", value: "name" },
        { label: "Available", value: "available" },
        { label: "Allocated", value: "allocated" },
        { label: "Total", value: "total" },
        { label: "Stock Status", value: "stockStatus" },
      ],
      defaultValue: "name",
      displayName: "Field",
    },
    previewState: {
      type: "choice",
      options: ["auto", "inStock", "lowStock", "outOfStock"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPLocationField",
};

export function EPLocationField(props: EPLocationFieldProps) {
  const { field = "name", className, previewState = "auto" } = props;

  const currentLocation = useSelector("currentLocation") as
    | StockLocationData
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState !== "auto" ||
    (!currentLocation && inEditor);
  const mockLocation =
    MOCK_STOCK_LOCATIONS[PREVIEW_LOCATION_INDEX[previewState] ?? 0];
  const effectiveLocation = useMock ? mockLocation : currentLocation;

  if (!effectiveLocation) {
    return <span className={className}>—</span>;
  }

  let value: string;
  if (field === "stockStatus") {
    const status = effectiveLocation.stockStatus;
    value = status === "low"
      ? "Low Stock"
      : status === "out-of-stock"
        ? "Out of Stock"
        : "In Stock";
  } else {
    value = String(effectiveLocation[field] ?? "");
  }

  return <span className={className}>{value}</span>;
}

export function registerEPLocationField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPLocationFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPLocationField, customMeta ?? epLocationFieldMeta);
}
