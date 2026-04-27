import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { useFormContext } from "react-hook-form";
import { Registerable } from "../registerable";
import { MOCK_STOCK_LOCATIONS } from "../utils/design-time-data";
import type { StockLocationData } from "./StockContext";

type PreviewState = "auto" | "inStock" | "lowStock" | "outOfStock" | "selected";

const PREVIEW_LOCATION_INDEX: Record<string, number> = {
  inStock: 0,
  lowStock: 1,
  outOfStock: 2,
  selected: 0,
};

interface EPLocationPickerProps {
  children?: React.ReactNode;
  className?: string;
  required?: boolean;
  previewState?: PreviewState;
}

export const epLocationPickerMeta: CodeComponentMeta<EPLocationPickerProps> = {
  name: "plasmic-commerce-ep-location-picker",
  displayName: "EP Location Picker",
  description:
    "Makes a location selectable when clicked. Out-of-stock locations are disabled. Selection automatically flows to the Add To Cart button. Place inside an EP Stock Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-location-field",
          props: { field: "name" },
        },
        {
          type: "component",
          name: "plasmic-commerce-ep-location-field",
          props: { field: "available" },
        },
        {
          type: "component",
          name: "plasmic-commerce-ep-location-field",
          props: { field: "stockStatus" },
        },
      ],
    },
    required: {
      type: "boolean",
      defaultValue: false,
      description:
        "Whether location selection is required before adding to cart",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "inStock", "lowStock", "outOfStock", "selected"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPLocationPicker",
  providesData: true,
};

export function EPLocationPicker(props: EPLocationPickerProps) {
  const { children, className, previewState = "auto" } = props;

  const currentLocation = useSelector("currentLocation") as
    | StockLocationData
    | undefined;
  const a11y = useSelector("locationPickerA11y") as
    | { isFocusTarget: boolean }
    | undefined;
  const form = useFormContext();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState !== "auto" ||
    (!currentLocation && inEditor);
  const mockLocation =
    MOCK_STOCK_LOCATIONS[PREVIEW_LOCATION_INDEX[previewState] ?? 0];
  const effectiveLocation = useMock ? mockLocation : currentLocation;

  const selectedSlug = form?.watch("SelectedLocationSlug") as
    | string
    | undefined;
  const isSelected = previewState === "selected"
    ? true
    : (!!effectiveLocation?.slug && selectedSlug === effectiveLocation.slug);
  const isOutOfStock = effectiveLocation ? !effectiveLocation.isInStock : false;
  const isDisabled = isOutOfStock;
  const isFocusTarget = a11y?.isFocusTarget ?? isSelected;

  const handleSelect = () => {
    if (!form || !currentLocation || isDisabled || isSelected || useMock) {
      return;
    }
    form.setValue("SelectedLocationSlug", currentLocation.slug);
  };

  return (
    <DataProvider name="isLocationSelected" data={isSelected}>
      <div
        className={className}
        onClick={handleSelect}
        role="radio"
        aria-checked={isSelected}
        tabIndex={isFocusTarget ? 0 : -1}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isDisabled) {
            e.preventDefault();
            handleSelect();
          }
        }}
        aria-disabled={isDisabled || undefined}
        aria-label={effectiveLocation?.name}
        data-selected={isSelected || undefined}
        data-out-of-stock={isOutOfStock || undefined}
      >
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPLocationPicker(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPLocationPickerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPLocationPicker, customMeta ?? epLocationPickerMeta);
}
