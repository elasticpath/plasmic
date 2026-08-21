/**
 * EPRefinementList — facet filter list for catalog search.
 *
 * Wraps `useRefinementList()` from react-instantsearch. Headless — exposes
 * refinement items for designer to render with any Plasmic elements.
 * Supports toggleRefinement action via refActions.
 *
 * `singleSelect` switches the backing hook to `useMenu()` for radio-style
 * facets (e.g. a single-choice "scope" filter): selecting a value REPLACES
 * the current refinement instead of OR-combining, and re-selecting the
 * refined value clears it (the "All" affordance).
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
import { MOCK_REFINEMENT_ITEMS } from "./design-time-data";
import type { RefinementItem } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPRefinementListProps {
  children?: React.ReactNode;
  attribute?: string;
  label?: string;
  limit?: number;
  showMore?: boolean;
  searchable?: boolean;
  singleSelect?: boolean;
  itemGap?: string;
  className?: string;
  previewState?: PreviewState;
}

interface EPRefinementListActions {
  toggleRefinement(value: string): void;
}

export const epRefinementListMeta: CodeComponentMeta<EPRefinementListProps> = {
  name: "plasmic-commerce-ep-refinement-list",
  displayName: "EP Refinement List",
  description:
    "Facet filter list (e.g., Brand, Color, Material). Repeats children for each refinement value with toggle action. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      description:
        "Optional. Leave empty for the value's real label, count and refined state; fill it to compose your own against currentRefinement (including its toggle()).",
      hidePlaceholder: true,
    },
    attribute: {
      type: "string",
      displayName: "Attribute",
      description: 'Facet attribute name (e.g., "brand", "color", "material")',
      defaultValue: "brand",
    },
    label: {
      type: "string",
      displayName: "Label",
      description: "Display label for the filter group",
    },
    limit: {
      type: "number",
      displayName: "Limit",
      description: "Maximum number of items to show",
      defaultValue: 10,
    },
    showMore: {
      type: "boolean",
      displayName: "Show More",
      description: "Allow expanding beyond limit",
      defaultValue: false,
    },
    searchable: {
      type: "boolean",
      displayName: "Searchable",
      description: "Allow searching within facet values",
      defaultValue: false,
    },
    singleSelect: {
      type: "boolean",
      displayName: "Single Select",
      description:
        "Radio-style facet: selecting a value replaces the current refinement instead of combining (uses InstantSearch's menu widget). Re-selecting the refined value clears it. Searchable is ignored in this mode.",
      defaultValue: false,
    },
    itemGap: {
      type: "string",
      displayName: "Item Gap",
      description:
        "Single-select mode lays items out as a wrapping flex ROW (pill style) with this gap. Ignored in multi-select mode (vertical list). Set inline because Plasmic strips layout styles from code-component instances.",
      defaultValue: "9.5px",
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
  importName: "EPRefinementList",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
  refActions: {
    toggleRefinement: {
      description: "Toggle a facet value on or off",
      argTypes: [{ name: "value", type: "string" }],
    },
  },
};

/**
 * What a facet value renders when the slot is empty.
 *
 * The registered default was the literal text "Filter Value" and "(0)", so every
 * value looked identical and priced at nothing. This shows the real label, count
 * and refined state — and nothing more: the component deliberately pre-renders
 * no button or <a>, exposing `toggle` on the item instead so the designer wires
 * the click in Studio.
 */
function DefaultRefinementRow(props: {
  label: string;
  count: number;
  isRefined?: boolean;
}) {
  const { label, count, isRefined } = props;
  return (
    <span data-ep-refinement="" data-refined={isRefined || undefined}>
      <span data-ep-refinement-label="">{label}</span>
      <span data-ep-refinement-count="">{count}</span>
    </span>
  );
}

export const EPRefinementList = React.forwardRef<
  EPRefinementListActions,
  EPRefinementListProps
>(function EPRefinementList(props, ref) {
  const {
    children,
    attribute,
    label,
    limit = 10,
    showMore = false,
    searchable = false,
    singleSelect = false,
    itemGap = "9.5px",
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockRefinementList
        ref={ref}
        className={className}
        label={label}
        singleSelect={singleSelect}
        itemGap={itemGap}
      >
        {children}
      </MockRefinementList>
    );
  }

  // Separate inner components — the backing InstantSearch hook differs
  // (useMenu vs useRefinementList) and hooks cannot be picked conditionally
  // within one component.
  if (singleSelect) {
    return (
      <EPMenuListInner
        ref={ref}
        attribute={attribute || "brand"}
        label={label}
        limit={limit}
        showMore={showMore}
        itemGap={itemGap}
        className={className}
      >
        {children}
      </EPMenuListInner>
    );
  }

  return (
    <EPRefinementListInner
      ref={ref}
      attribute={attribute || "brand"}
      label={label}
      limit={limit}
      showMore={showMore}
      searchable={searchable}
      className={className}
    >
      {children}
    </EPRefinementListInner>
  );
});

const MockRefinementList = React.forwardRef<
  EPRefinementListActions,
  {
    children?: React.ReactNode;
    className?: string;
    label?: string;
    singleSelect?: boolean;
    itemGap?: string;
  }
>(function MockRefinementList(
  { children, className, label, singleSelect, itemGap },
  ref
) {
  useImperativeHandle(ref, () => ({
    toggleRefinement: () => {},
  }));

  // Mirror the runtime singleSelect layout (EPMenuListInner) so the Studio
  // canvas matches the browser: a wrapping flex pill-row instead of the
  // default vertical block list.
  const listStyle: React.CSSProperties | undefined = singleSelect
    ? { display: "flex", flexWrap: "wrap", gap: itemGap }
    : undefined;

  return (
    <div
      className={className}
      data-ep-refinement-list=""
      {...(singleSelect ? { "data-single-select": "" } : {})}
      aria-label={label}
    >
      <div role="list" style={listStyle}>
        {MOCK_REFINEMENT_ITEMS.map((item, i) => (
          <div key={item.value} role="listitem">
            <DataProvider name="currentRefinement" data={item}>
              <DataProvider name="currentRefinementIndex" data={i}>
                {children ? (
                  repeatedElement(i, children)
                ) : (
                  <DefaultRefinementRow
                    label={item.label}
                    count={item.count}
                    isRefined={item.isRefined}
                  />
                )}
              </DataProvider>
            </DataProvider>
          </div>
        ))}
      </div>
    </div>
  );
});

const EPRefinementListInner = React.forwardRef<
  EPRefinementListActions,
  {
    children?: React.ReactNode;
    attribute: string;
    label?: string;
    limit: number;
    showMore: boolean;
    searchable: boolean;
    className?: string;
  }
>(function EPRefinementListInner(
  { children, attribute, label, limit, showMore, searchable, className },
  ref
) {
  const { useRefinementList } = require("react-instantsearch");
  const { items, refine } = useRefinementList({
    attribute,
    limit,
    showMore,
    searchable,
  });

  useImperativeHandle(ref, () => ({
    toggleRefinement: (value: string) => refine(value),
  }));

  // Expose `toggle` as part of the per-item context so designers can wire
  // a click in Studio (interaction → customFunction `$ctx.currentRefinement.toggle()`)
  // without the component pre-rendering a button or <a>. Functions in
  // DataProvider data are passed through React context untouched, so this
  // costs nothing for designers who don't use it.
  const normalizedItems = useMemo(
    () =>
      (items || []).map((item: any) => ({
        value: item.value,
        label: item.label,
        count: item.count,
        isRefined: item.isRefined,
        toggle: () => refine(item.value),
      })),
    [items, refine]
  );

  if (normalizedItems.length === 0) return null;

  return (
    <div className={className} data-ep-refinement-list="" aria-label={label}>
      <div role="list">
        {normalizedItems.map((item: any, i: number) => (
          <div key={item.value} role="listitem">
            <DataProvider name="currentRefinement" data={item}>
              <DataProvider name="currentRefinementIndex" data={i}>
                {children ? (
                  repeatedElement(i, children)
                ) : (
                  <DefaultRefinementRow
                    label={item.label}
                    count={item.count}
                    isRefined={item.isRefined}
                  />
                )}
              </DataProvider>
            </DataProvider>
          </div>
        ))}
      </div>
    </div>
  );
});

const EPMenuListInner = React.forwardRef<
  EPRefinementListActions,
  {
    children?: React.ReactNode;
    attribute: string;
    label?: string;
    limit: number;
    showMore: boolean;
    itemGap?: string;
    className?: string;
  }
>(function EPMenuListInner(
  { children, attribute, label, limit, showMore, itemGap, className },
  ref
) {
  const { useMenu } = require("react-instantsearch");
  const { items, refine } = useMenu({
    attribute,
    limit,
    showMore,
    // Highest-count value first (e.g. the largest scope before smaller
    // ones); name breaks ties deterministically.
    sortBy: ["count:desc", "name:asc"],
  });

  useImperativeHandle(ref, () => ({
    toggleRefinement: (value: string) => refine(value),
  }));

  // Same per-item shape as the multi-select path (value/label/count/
  // isRefined/toggle) so designs can switch modes without rebinding.
  const normalizedItems = useMemo(
    () =>
      (items || []).map((item: any) => ({
        value: item.value,
        label: item.label,
        count: item.count,
        isRefined: item.isRefined,
        toggle: () => refine(item.value),
      })),
    [items, refine]
  );

  if (normalizedItems.length === 0) return null;

  return (
    <div
      className={className}
      data-ep-refinement-list=""
      data-single-select=""
      aria-label={label}
    >
      {/* Inline flex-row — Plasmic strips layout styles from code-component
          instances, so the pill row is laid out here (gap via itemGap). */}
      <div
        role="list"
        style={{ display: "flex", flexWrap: "wrap", gap: itemGap }}
      >
        {normalizedItems.map((item: any, i: number) => (
          <div key={item.value} role="listitem">
            <DataProvider name="currentRefinement" data={item}>
              <DataProvider name="currentRefinementIndex" data={i}>
                {children ? (
                  repeatedElement(i, children)
                ) : (
                  <DefaultRefinementRow
                    label={item.label}
                    count={item.count}
                    isRefined={item.isRefined}
                  />
                )}
              </DataProvider>
            </DataProvider>
          </div>
        ))}
      </div>
    </div>
  );
});

export function registerEPRefinementList(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPRefinementListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPRefinementList, customMeta ?? epRefinementListMeta);
}
