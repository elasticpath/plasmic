import { usePlasmicCanvasContext } from "@plasmicapp/host";
import type React from "react";
import {
  DEFAULT_PRODUCT_PATH_PREFIX,
  PRODUCT_PATH_PREFIX_PROP,
} from "../utils/product-path";

export type PreviewState = "auto" | "withData";

export const DEFAULT_GRID_TEMPLATE_COLUMNS =
  "repeat(auto-fill, minmax(220px, 1fr))";
export const DEFAULT_GRID_GAP = "24px";

export interface HitsGridLayoutProps {
  gridTemplateColumns?: string;
  gridGap?: string;
  productPathPrefix?: string;
  previewState?: PreviewState;
}

export interface HitsGridProps {
  children?: React.ReactNode;
  className?: string;
  gridStyle: React.CSSProperties;
  productPathPrefix?: string;
}

// Default grid layout — applied as inline style so it survives Plasmic's
// className filter (which strips display/grid props from code component
// instances).
//
// `align-self: stretch` keeps the grid full-width when its parent is a flex
// container with `align-items: center` (a common Plasmic page layout).
// Without it the grid collapses to its `min-content` (one column) because
// flex defaults each child to `align-self: auto`.
export function buildHitsGridStyle(
  gridTemplateColumns: string,
  gap: string
): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns,
    gap,
    width: "100%",
    alignSelf: "stretch",
  };
}

export const HITS_CARD_SLOT = {
  type: "slot",
  defaultValue: [
    {
      type: "vbox",
      children: [
        { type: "text", value: "Product Name" },
        { type: "text", value: "$0.00" },
      ],
    },
  ],
} as const;

export function hitsGridMetaProps(gridTemplateColumnsDescription: string) {
  return {
    gridTemplateColumns: {
      type: "string",
      displayName: "Grid Template Columns",
      description: gridTemplateColumnsDescription,
      defaultValue: DEFAULT_GRID_TEMPLATE_COLUMNS,
    },
    gridGap: {
      type: "string",
      displayName: "Grid Gap",
      description: "CSS gap between hit cards.",
      defaultValue: DEFAULT_GRID_GAP,
    },
    productPathPrefix: PRODUCT_PATH_PREFIX_PROP,
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
  } as const;
}

export function useHitsGrid(props: HitsGridLayoutProps) {
  const {
    gridTemplateColumns = DEFAULT_GRID_TEMPLATE_COLUMNS,
    gridGap = DEFAULT_GRID_GAP,
    productPathPrefix = DEFAULT_PRODUCT_PATH_PREFIX,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  return {
    useMock,
    gridStyle: buildHitsGridStyle(gridTemplateColumns, gridGap),
    productPathPrefix,
  };
}
