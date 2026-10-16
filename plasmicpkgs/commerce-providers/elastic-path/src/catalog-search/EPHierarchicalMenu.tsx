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
  CanvasComponentProps,
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useImperativeHandle, useMemo } from "react";
import { Registerable } from "../registerable";
import { ChooseFieldPrompt } from "./ChooseFieldPrompt";
import { MOCK_CATEGORY_ITEMS } from "./design-time-data";
import type { CategoryItem } from "./design-time-data";
import {
  SearchAttributeContext,
  hierarchyOptions,
  useSearchAttributeDiscovery,
} from "./search-attributes";
import { useHierarchicalMenu } from "react-instantsearch";

type PreviewState = "auto" | "withData";

interface EPHierarchicalMenuProps
  extends CanvasComponentProps<SearchAttributeContext> {
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
      description:
        "Optional. Leave empty for the category's real label, count, depth and refined state; fill it to compose your own against currentCategory (including its refine()).",
      hidePlaceholder: true,
    },
    attributes: {
      type: "choice",
      displayName: "Attributes",
      description:
        "Hierarchy levels to navigate, listed from the connected store's catalog search. For levels the list does not show, bind a comma-separated value. Unset: the filter is left out of the search and shows nothing on a live page; on the canvas it asks for a field.",
      options: (props, ctx) => hierarchyOptions(props.attributes, ctx),
      allowSearch: true,
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


/**
 * What a category renders when the slot is empty.
 *
 * The registered default was the literal text "Category" and "(0)". Like
 * EPRefinementList this pre-renders nothing interactive — `refine` is on the
 * item so the designer wires the click — and it carries `data-depth` because a
 * flattened tree is unreadable without indentation.
 */
function DefaultCategoryRow(props: {
  label: string;
  count: number;
  depth: number;
  isRefined?: boolean;
  hasChildren?: boolean;
}) {
  const { label, count, depth, isRefined, hasChildren } = props;
  return (
    <span
      data-ep-category=""
      data-depth={depth}
      data-refined={isRefined || undefined}
      data-has-children={hasChildren || undefined}
    >
      <span data-ep-category-label="">{label}</span>
      <span data-ep-category-count="">{count}</span>
    </span>
  );
}

function splitLevels(attributes: string | undefined): string[] {
  return (attributes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const EPHierarchicalMenu = React.forwardRef<
  EPHierarchicalMenuActions,
  EPHierarchicalMenuProps
>(function EPHierarchicalMenu(props, ref) {
  const {
    children,
    attributes,
    className,
    previewState = "auto",
    setControlContextData,
  } = props;

  useSearchAttributeDiscovery(setControlContextData);

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  const levels = splitLevels(attributes);
  if (levels.length === 0) {
    return inEditor ? (
      <ChooseFieldPrompt
        propName="Attributes"
        componentName="EP Hierarchical Menu"
        className={className}
      />
    ) : null;
  }

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
      attributes={levels.join(",")}
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
          <div key={item.value} role="listitem">
            <DataProvider name="currentCategory" data={item}>
              {children ? (
                repeatedElement(i, children)
              ) : (
                <DefaultCategoryRow
                  label={item.label}
                  count={item.count}
                  depth={item.depth ?? 0}
                  isRefined={item.isRefined}
                  hasChildren={item.hasChildren}
                />
              )}
            </DataProvider>
          </div>
        ))}
      </div>
    </div>
  );
});

const EPHierarchicalMenuInner = React.forwardRef<
  EPHierarchicalMenuActions,
  {
    children?: React.ReactNode;
    attributes: string;
    className?: string;
  }
>(function EPHierarchicalMenuInner({ children, attributes, className }, ref) {
  const attributeArray = useMemo(() => splitLevels(attributes), [attributes]);

  const { items, refine } = useHierarchicalMenu({
    attributes: attributeArray,
  });

  useImperativeHandle(ref, () => ({
    refineCategory: (value: string) => refine(value),
  }));

  // Expose `refine` on each category so designers can wire a click in
  // Studio (interaction → customFunction `$ctx.currentCategory.refine()`)
  // without the component pre-rendering a button. See EPRefinementList for
  // the same pattern.
  const flatItems = useMemo(() => {
    const flat = flattenHierarchicalItems(items || []);
    return flat.map((item) => ({
      ...item,
      refine: () => refine(item.value),
    }));
  }, [items, refine]);

  if (flatItems.length === 0) return null;

  return (
    <div className={className} data-ep-hierarchical-menu="">
      <div role="list">
        {flatItems.map((item: any, i: number) => (
          <div key={item.value} role="listitem">
            <DataProvider name="currentCategory" data={item}>
              {children ? (
                repeatedElement(i, children)
              ) : (
                <DefaultCategoryRow
                  label={item.label}
                  count={item.count}
                  depth={item.depth ?? 0}
                  isRefined={item.isRefined}
                  hasChildren={item.hasChildren}
                />
              )}
            </DataProvider>
          </div>
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
