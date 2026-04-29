/**
 * EPHierarchicalMenu — category tree navigation for catalog search.
 *
 * Wraps `useHierarchicalMenu()` from react-instantsearch. Headless repeater
 * over category levels with refineCategory action.
 */

import {
  DataProvider,
  repeatedElement,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useImperativeHandle, useMemo } from "react";
import { Registerable } from "../registerable";
import { MOCK_CATEGORY_ITEMS } from "./design-time-data";
import type { CategoryItem } from "./design-time-data";

type PreviewState = "auto" | "withData";

// Defensive style — make every category item act as a clickable button
// without forcing designers to wire onClick handlers themselves.
const CATEGORY_ROW_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "inherit",
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
};

interface EPHierarchicalMenuProps {
  children?: React.ReactNode;
  attributes?: string;
  className?: string;
  previewState?: PreviewState;
}

interface EPHierarchicalMenuActions {
  refineCategory(value: string): void;
}

export const epHierarchicalMenuMeta: CodeComponentMeta<EPHierarchicalMenuProps> = {
  name: "plasmic-commerce-ep-hierarchical-menu",
  displayName: "EP Hierarchical Menu",
  description:
    "Category tree navigation for hierarchical facets. Repeats children per category item with refineCategory action. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "hbox",
          children: [
            { type: "text", value: "Category" },
            { type: "text", value: "(0)" },
          ],
        },
      ],
    },
    attributes: {
      type: "string",
      displayName: "Attributes",
      description:
        'Comma-separated hierarchy levels (e.g., "categories.lvl0,categories.lvl1,categories.lvl2")',
      defaultValue: "categories.lvl0,categories.lvl1,categories.lvl2",
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
  importName: "EPHierarchicalMenu",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
  refActions: {
    refineCategory: {
      description: "Refine to a specific category",
      argTypes: [{ name: "value", type: "string" }],
    },
  },
};

/**
 * Flatten InstantSearch hierarchical items into a flat list with depth info.
 * InstantSearch returns nested items; we flatten for the repeater.
 */
function flattenHierarchicalItems(
  items: any[],
  depth: number = 0
): CategoryItem[] {
  const result: CategoryItem[] = [];
  for (const item of items) {
    result.push({
      value: item.value,
      label: item.label,
      count: item.count,
      isRefined: item.isRefined,
      depth,
      hasChildren: !!(item.data && item.data.length > 0),
    });
    if (item.data && item.data.length > 0) {
      result.push(...flattenHierarchicalItems(item.data, depth + 1));
    }
  }
  return result;
}

export const EPHierarchicalMenu = React.forwardRef<
  EPHierarchicalMenuActions,
  EPHierarchicalMenuProps
>(function EPHierarchicalMenu(props, ref) {
  const { children, attributes, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockHierarchicalMenu ref={ref} className={className}>
        {children}
      </MockHierarchicalMenu>
    );
  }

  return (
    <EPHierarchicalMenuInner
      ref={ref}
      attributes={attributes}
      className={className}
    >
      {children}
    </EPHierarchicalMenuInner>
  );
});

const MockHierarchicalMenu = React.forwardRef<
  EPHierarchicalMenuActions,
  { children?: React.ReactNode; className?: string }
>(function MockHierarchicalMenu({ children, className }, ref) {
  useImperativeHandle(ref, () => ({
    refineCategory: () => {},
  }));

  return (
    <div className={className} data-ep-hierarchical-menu="">
      <div role="list">
        {MOCK_CATEGORY_ITEMS.map((item, i) => (
          <button
            key={item.value}
            type="button"
            role="listitem"
            aria-pressed={item.isRefined}
            style={CATEGORY_ROW_STYLE}
          >
            <DataProvider name="currentCategory" data={item}>
              {repeatedElement(i, children)}
            </DataProvider>
          </button>
        ))}
      </div>
    </div>
  );
});

const EPHierarchicalMenuInner = React.forwardRef<
  EPHierarchicalMenuActions,
  {
    children?: React.ReactNode;
    attributes?: string;
    className?: string;
  }
>(function EPHierarchicalMenuInner({ children, attributes, className }, ref) {
  const { useHierarchicalMenu } = require("react-instantsearch");

  const attributeArray = useMemo(
    () =>
      (attributes || "categories.lvl0,categories.lvl1,categories.lvl2")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
    [attributes]
  );

  const { items, refine } = useHierarchicalMenu({
    attributes: attributeArray,
  });

  useImperativeHandle(ref, () => ({
    refineCategory: (value: string) => refine(value),
  }));

  const flatItems = useMemo(
    () => flattenHierarchicalItems(items || []),
    [items]
  );

  if (flatItems.length === 0) return null;

  return (
    <div className={className} data-ep-hierarchical-menu="">
      <div role="list">
        {flatItems.map((item, i) => (
          <button
            key={item.value}
            type="button"
            role="listitem"
            aria-pressed={item.isRefined}
            onClick={() => refine(item.value)}
            style={CATEGORY_ROW_STYLE}
          >
            <DataProvider name="currentCategory" data={item}>
              {repeatedElement(i, children)}
            </DataProvider>
          </button>
        ))}
      </div>
    </div>
  );
});

export function registerEPHierarchicalMenu(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPHierarchicalMenuProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPHierarchicalMenu,
    customMeta ?? epHierarchicalMenuMeta
  );
}
