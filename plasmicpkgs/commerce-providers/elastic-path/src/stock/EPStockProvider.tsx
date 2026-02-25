import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import type { Product } from "@plasmicpkgs/commerce";
import React, { useEffect, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "../const";
import { Registerable } from "../registerable";
import { useProductStock } from "../inventory/use-stock";
import { useLocations } from "../inventory/use-locations";
import { getLocationDisplayName } from "../inventory/utils/displayHelpers";
import { isLowStock, isOutOfStock } from "../inventory/utils/stockCalculations";
import { getLocationSlug } from "../utils/getLocationSlug";
import { useRovingTabIndex } from "../utils/useRovingTabIndex";
import { createLogger } from "../utils/logger";
import {
  MOCK_STOCK_LOCATIONS,
  MOCK_PRODUCT_STOCK,
} from "../utils/design-time-data";
import type { StockLocationData, ProductStockSummary } from "./StockContext";

const log = createLogger("EPStockProvider");

type PreviewState = "auto" | "withLocations" | "loading" | "error" | "empty";

interface EPStockProviderProps {
  children?: React.ReactNode;
  header?: React.ReactNode;
  className?: string;
  lowStockThreshold?: number;
  maxLocations?: number;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  selectionMode?: "cards" | "dropdown";
  updateUrlOnChange?: boolean;
  groupLabel?: string;
  previewState?: PreviewState;
}

export const epStockProviderMeta: ComponentMeta<EPStockProviderProps> = {
  name: "plasmic-commerce-ep-stock-provider",
  displayName: "EP Stock Provider",
  description:
    "Fetches stock data for the current product. Renders a header once, then repeats children once per stock location (sorted in-stock first). Must be inside a Product Box.",
  props: {
    header: {
      type: "slot",
      displayName: "Header",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-stock-field",
          props: { field: "stockStatus" },
        },
      ],
    },
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-location-picker",
        },
      ],
    },
    selectionMode: {
      type: "choice",
      options: ["cards", "dropdown"],
      defaultValue: "cards",
      displayName: "Selection Mode",
      description:
        "Cards: accessible radio cards with keyboard navigation. Dropdown: native select for many locations.",
    },
    groupLabel: {
      type: "string",
      defaultValue: "Select a pickup location",
      displayName: "Group Label",
      description:
        "Accessible label for the location group (announced by screen readers)",
      advanced: true,
    },
    updateUrlOnChange: {
      type: "boolean",
      defaultValue: true,
      displayName: "Update URL on Change",
      description: "Sync the selected location to a ?location= query parameter for deep linking",
      advanced: true,
    },
    lowStockThreshold: {
      type: "number",
      defaultValue: DEFAULT_LOW_STOCK_THRESHOLD,
      displayName: "Low Stock Threshold",
      description: "Stock level below which items show as low stock",
    },
    maxLocations: {
      type: "number",
      defaultValue: 10,
      displayName: "Max Locations",
      description: "Maximum number of locations to display",
    },
    loadingContent: {
      type: "slot",
      displayName: "Loading Content",
      defaultValue: {
        type: "text",
        value: "Loading stock...",
      },
    },
    errorContent: {
      type: "slot",
      displayName: "Error Content",
      defaultValue: {
        type: "text",
        value: "Unable to load stock information",
      },
    },
    emptyContent: {
      type: "slot",
      displayName: "Empty Content",
      defaultValue: {
        type: "text",
        value: "No locations available",
      },
    },
    previewState: {
      type: "choice",
      options: ["auto", "withLocations", "loading", "error", "empty"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPStockProvider",
  providesData: true,
};

const STOCK_SORT_ORDER: Record<string, number> = {
  "in-stock": 0,
  "low": 1,
  "out-of-stock": 2,
};

export function EPStockProvider(props: EPStockProviderProps) {
  const {
    children,
    header,
    className,
    lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
    maxLocations = 10,
    loadingContent,
    errorContent,
    emptyContent,
    selectionMode = "cards",
    updateUrlOnChange = true,
    groupLabel = "Select a pickup location",
    previewState = "auto",
  } = props;

  const product = useSelector("currentProduct") as Product | undefined;
  const form = useFormContext();
  const inEditor = !!usePlasmicCanvasContext();

  // For variant products, wait until a variant is selected before fetching stock.
  // For simple products (no variations), use the product ID directly.
  const hasVariations = (product?.options?.length ?? 0) > 0;
  const selectedVariantId = form?.watch("ProductVariant") as string | undefined;
  const stockProductId = hasVariations
    ? (selectedVariantId || "")
    : (product?.id || "");

  const { stock, loading: stockLoading, error: stockError } = useProductStock(
    stockProductId,
    undefined,
    !!stockProductId
  );
  const { locations, loading: locationsLoading } = useLocations();
  const { containerRef, onKeyDown: handleGroupKeyDown } = useRovingTabIndex();

  const loading = stockLoading || locationsLoading;

  // All useMemo hooks must be called unconditionally (React rules of hooks)
  const stockLocations = useMemo<StockLocationData[]>(() => {
    if (!stock?.locations) return [];
    const mapped = stock.locations.map((ls) => {
      const available = Number(ls.stock.available || 0);
      const allocated = Number(ls.stock.allocated || 0);
      return {
        name: getLocationDisplayName(ls.location, locations),
        slug: getLocationSlug(ls.location),
        available,
        allocated,
        total: Number(ls.stock.total || 0),
        isInStock: !isOutOfStock(available),
        isLowStock: isLowStock(available, lowStockThreshold),
        stockStatus: isOutOfStock(available)
          ? ("out-of-stock" as const)
          : isLowStock(available, lowStockThreshold)
            ? ("low" as const)
            : ("in-stock" as const),
      };
    });
    mapped.sort(
      (a, b) =>
        (STOCK_SORT_ORDER[a.stockStatus] ?? 2) -
        (STOCK_SORT_ORDER[b.stockStatus] ?? 2)
    );
    return mapped;
  }, [stock, locations, lowStockThreshold]);

  const productStock = useMemo<ProductStockSummary | null>(() => {
    if (!stock) return null;
    return {
      totalAvailable: stock.totalAvailable,
      totalAllocated: stock.totalAllocated,
      locationCount: stock.locations.length,
      isInStock: !isOutOfStock(stock.totalAvailable),
      isLowStock: isLowStock(stock.totalAvailable, lowStockThreshold),
    };
  }, [stock, lowStockThreshold]);

  // Initialize location selection from ?location= URL param
  useEffect(() => {
    if (!form || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const locationFromUrl = url.searchParams.get("location");
      if (locationFromUrl && !form.getValues("SelectedLocationSlug")) {
        form.setValue("SelectedLocationSlug", locationFromUrl);
      }
    } catch {
      // ignore
    }
  }, [form]);

  // Sync selected location to URL
  const selectedSlugForUrl = form?.watch("SelectedLocationSlug") as string | undefined;
  useEffect(() => {
    if (!updateUrlOnChange || !selectedSlugForUrl || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("location") !== selectedSlugForUrl) {
        url.searchParams.set("location", selectedSlugForUrl);
        window.history.replaceState({}, "", url.toString());
      }
    } catch {
      // ignore
    }
  }, [selectedSlugForUrl, updateUrlOnChange]);

  // --- Preview state handling (after all hooks) ---

  if (previewState === "loading") {
    return <div className={className}>{loadingContent}</div>;
  }
  if (previewState === "error") {
    return <div className={className}>{errorContent}</div>;
  }
  if (previewState === "empty") {
    return (
      <DataProvider name="productStock" data={MOCK_PRODUCT_STOCK}>
        <div className={className}>{emptyContent}</div>
      </DataProvider>
    );
  }

  const useMock =
    previewState === "withLocations" ||
    (previewState === "auto" && !product?.id && inEditor);

  if (useMock) {
    log.debug("Using mock stock data for design-time preview");
    const mockDisplayed = MOCK_STOCK_LOCATIONS.slice(0, maxLocations);
    const firstEnabledSlug = mockDisplayed.find((l) => l.isInStock)?.slug;

    return (
      <DataProvider name="productStock" data={MOCK_PRODUCT_STOCK}>
        <DataProvider name="stockLocations" data={MOCK_STOCK_LOCATIONS}>
          <div
            className={className}
            ref={selectionMode === "cards" ? containerRef : undefined}
            role={selectionMode === "cards" ? "radiogroup" : undefined}
            aria-label={selectionMode === "cards" ? groupLabel : undefined}
            onKeyDown={
              selectionMode === "cards" ? handleGroupKeyDown : undefined
            }
          >
            {header}
            {selectionMode === "dropdown" ? (
              <select aria-label={groupLabel}>
                <option value="" disabled>
                  Choose a location...
                </option>
                {mockDisplayed.map((location) => (
                  <option
                    key={location.slug}
                    value={location.slug}
                    disabled={!location.isInStock}
                  >
                    {location.name}
                    {!location.isInStock
                      ? " (Out of Stock)"
                      : location.isLowStock
                        ? " (Low Stock)"
                        : ` (${location.available} available)`}
                  </option>
                ))}
              </select>
            ) : (
              mockDisplayed.map((location, i) => (
                <DataProvider
                  key={location.slug}
                  name="currentLocation"
                  data={location}
                >
                  <DataProvider name="currentLocationIndex" data={i}>
                    <DataProvider
                      name="locationPickerA11y"
                      data={{
                        isFocusTarget: location.slug === firstEnabledSlug,
                      }}
                    >
                      {repeatedElement(i, children)}
                    </DataProvider>
                  </DataProvider>
                </DataProvider>
              ))
            )}
          </div>
        </DataProvider>
      </DataProvider>
    );
  }

  // --- Real data path ---

  if (loading) {
    return <div className={className}>{loadingContent}</div>;
  }

  if (stockError) {
    return <div className={className}>{errorContent}</div>;
  }

  const displayedLocations = stockLocations.slice(0, maxLocations);

  if (displayedLocations.length === 0) {
    return (
      <DataProvider name="productStock" data={productStock}>
        <div className={className}>{emptyContent}</div>
      </DataProvider>
    );
  }

  const selectedSlug = form?.watch("SelectedLocationSlug") as
    | string
    | undefined;
  const firstEnabledSlug = displayedLocations.find(
    (l) => l.isInStock
  )?.slug;
  const focusTargetSlug =
    selectedSlug || firstEnabledSlug || displayedLocations[0]?.slug;

  const renderDropdown = () => (
    <select
      value={selectedSlug || ""}
      onChange={(e) => form?.setValue("SelectedLocationSlug", e.target.value)}
      aria-label={groupLabel}
    >
      <option value="" disabled>
        Choose a location...
      </option>
      {displayedLocations.map((location) => (
        <option
          key={location.slug}
          value={location.slug}
          disabled={!location.isInStock}
        >
          {location.name}
          {!location.isInStock
            ? " (Out of Stock)"
            : location.isLowStock
            ? " (Low Stock)"
            : ` (${location.available} available)`}
        </option>
      ))}
    </select>
  );

  const renderCards = () =>
    displayedLocations.map((location, i) => (
      <DataProvider
        key={location.slug}
        name="currentLocation"
        data={location}
      >
        <DataProvider name="currentLocationIndex" data={i}>
          <DataProvider
            name="locationPickerA11y"
            data={{ isFocusTarget: location.slug === focusTargetSlug }}
          >
            {repeatedElement(i, children)}
          </DataProvider>
        </DataProvider>
      </DataProvider>
    ));

  return (
    <DataProvider name="productStock" data={productStock}>
      <DataProvider name="stockLocations" data={stockLocations}>
        <div
          className={className}
          ref={selectionMode === "cards" ? containerRef : undefined}
          role={selectionMode === "cards" ? "radiogroup" : undefined}
          aria-label={selectionMode === "cards" ? groupLabel : undefined}
          onKeyDown={selectionMode === "cards" ? handleGroupKeyDown : undefined}
        >
          {header}
          {selectionMode === "dropdown" ? renderDropdown() : renderCards()}
        </div>
      </DataProvider>
    </DataProvider>
  );
}

export function registerEPStockProvider(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPStockProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPStockProvider, customMeta ?? epStockProviderMeta);
}
