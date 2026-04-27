/**
 * EPRangeFilter — numeric range filter for catalog search.
 *
 * Wraps `useRange()` from react-instantsearch. Exposes rangeData
 * (min, max, currentMin, currentMax) for the designer to render as
 * a slider, inputs, or preset buttons.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle } from "react";
import { Registerable } from "../registerable";
import { MOCK_RANGE_DATA } from "./design-time-data";
import type { RangeData } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPRangeFilterProps {
  children?: React.ReactNode;
  attribute?: string;
  className?: string;
  previewState?: PreviewState;
}

interface EPRangeFilterActions {
  setRange(min: number, max: number): void;
}

export const epRangeFilterMeta: CodeComponentMeta<EPRangeFilterProps> = {
  name: "plasmic-commerce-ep-range-filter",
  displayName: "EP Range Filter",
  description:
    "Numeric range filter (price, rating, etc.). Exposes rangeData with min/max for binding. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: {
        type: "text",
        value: "$25 - $250",
      },
    },
    attribute: {
      type: "string",
      displayName: "Attribute",
      description:
        'Numeric attribute name (e.g., "price.USD.float_price", "rating")',
      defaultValue: "price.USD.float_price",
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPRangeFilter",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
  refActions: {
    setRange: {
      description: "Set the numeric range filter",
      argTypes: [
        { name: "min", type: "number" },
        { name: "max", type: "number" },
      ],
    },
  },
};

export const EPRangeFilter = React.forwardRef<
  EPRangeFilterActions,
  EPRangeFilterProps
>(function EPRangeFilter(props, ref) {
  const { children, attribute, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockRangeFilter ref={ref} className={className}>
        {children}
      </MockRangeFilter>
    );
  }

  return (
    <EPRangeFilterInner
      ref={ref}
      attribute={attribute || "price.USD.float_price"}
      className={className}
    >
      {children}
    </EPRangeFilterInner>
  );
});

const MockRangeFilter = React.forwardRef<
  EPRangeFilterActions,
  { children?: React.ReactNode; className?: string }
>(function MockRangeFilter({ children, className }, ref) {
  useImperativeHandle(ref, () => ({
    setRange: () => {},
  }));

  return (
    <DataProvider name="rangeData" data={MOCK_RANGE_DATA}>
      <div className={className} data-ep-range-filter="">
        {children}
      </div>
    </DataProvider>
  );
});

const EPRangeFilterInner = React.forwardRef<
  EPRangeFilterActions,
  {
    children?: React.ReactNode;
    attribute: string;
    className?: string;
  }
>(function EPRangeFilterInner({ children, attribute, className }, ref) {
  const { useRange } = require("react-instantsearch");
  const { range, start, refine, canRefine } = useRange({ attribute });

  const handleSetRange = useCallback(
    (min: number, max: number) => {
      refine([min, max]);
    },
    [refine]
  );

  useImperativeHandle(ref, () => ({
    setRange: handleSetRange,
  }));

  const rangeData: RangeData = {
    min: range.min ?? 0,
    max: range.max ?? 0,
    currentMin: start[0] ?? range.min ?? 0,
    currentMax: start[1] ?? range.max ?? 0,
    canRefine,
  };

  return (
    <DataProvider name="rangeData" data={rangeData}>
      <div className={className} data-ep-range-filter="">
        {children}
      </div>
    </DataProvider>
  );
});

export function registerEPRangeFilter(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPRangeFilterProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPRangeFilter, customMeta ?? epRangeFilterMeta);
}
