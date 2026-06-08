/**
 * EPSingleSelectFacet — radio-style "pick one" facet for catalog search
 * (ADR-0011 D5).
 *
 * Wraps `useMenu()` from react-instantsearch: selecting a value REPLACES the
 * current refinement (single choice) instead of OR-combining, and re-selecting
 * the refined value clears it. This is the split-out of EPRefinementList's old
 * `singleSelect` flag — a dedicated component (radiogroup a11y, replace
 * semantics, the accreting All-option concern) rather than a flag where half
 * the sibling props no-op (the SwiftUI "compose, don't enumerate" anti-pattern,
 * and the house precedent of ADR-0005's EPVariationOptionList split).
 *
 * The per-item context is identical to EPRefinementList's
 * (`value`/`label`/`count`/`isRefined`/`toggle`), so slot content ports across
 * a mode change — plus `isAllOption` to style the "All" affordance.
 *
 * Auto-wiring (D2, default on) makes each row a radio: click/Enter/Space
 * select, `aria-checked`/`[data-active]` reflect the state. Off → wire
 * `$ctx.currentRefinement.toggle()` yourself.
 *
 * `includeAllOption` (D6, default off) prepends an "All" pseudo-item that is
 * refined when nothing is refined and clears the facet when chosen — so a
 * scope bar needs neither a second `EPClearRefinements` component nor an
 * `isRefined` ternary.
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
import { autoWireItem } from "./auto-wire";
import { MOCK_REFINEMENT_ITEMS } from "./design-time-data";

type PreviewState = "auto" | "withData";

/** Per-item context — the EPRefinementList shape plus the All-option flag. */
export interface SingleSelectFacetItem {
  value: string;
  label: string;
  count?: number;
  isRefined: boolean;
  toggle: () => void;
  /** True for the synthetic "All" pseudo-item (D6). */
  isAllOption: boolean;
}

interface EPSingleSelectFacetProps {
  children?: React.ReactNode;
  attribute?: string;
  label?: string;
  limit?: number;
  showMore?: boolean;
  includeAllOption?: boolean;
  allOptionLabel?: string;
  autoWire?: boolean;
  itemGap?: string;
  className?: string;
  previewState?: PreviewState;
}

interface EPSingleSelectFacetActions {
  /** Select a value (replace semantics). */
  select(value: string): void;
  /** Clear the facet (the "All" affordance). */
  clear(): void;
}

export const epSingleSelectFacetMeta: CodeComponentMeta<EPSingleSelectFacetProps> =
  {
    name: "plasmic-commerce-ep-single-select-facet",
    displayName: "EP Single Select Facet",
    section: "EP Catalog Search",
    description:
      "Radio-style 'pick one' facet (e.g. a scope filter). Selecting a value replaces the current choice; re-selecting clears it. Repeats children per value with auto-wired radio semantics. Enable Include All Option for a built-in 'All' pill. Must be inside EP Catalog Search Provider.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "hbox",
            children: [
              { type: "text", value: "Option" },
              { type: "text", value: "(0)" },
            ],
          },
        ],
      },
      attribute: {
        type: "string",
        displayName: "Attribute",
        description: "Facet attribute name to pick one value from.",
        defaultValue: "brand",
      },
      label: {
        type: "string",
        displayName: "Label",
        description: "Accessible label for the radio group.",
      },
      limit: {
        type: "number",
        displayName: "Limit",
        description: "Maximum number of values to show.",
        defaultValue: 10,
      },
      showMore: {
        type: "boolean",
        displayName: "Show More",
        description: "Allow expanding beyond limit.",
        defaultValue: false,
      },
      includeAllOption: {
        type: "boolean",
        displayName: "Include All Option",
        description:
          'Prepend an "All" pseudo-item: refined when nothing is refined, clears the facet when chosen. Style it via $ctx.currentRefinement.isAllOption. Off keeps the values-only list.',
        defaultValue: false,
      },
      allOptionLabel: {
        type: "string",
        displayName: "All Option Label",
        description: 'Label for the All pseudo-item.',
        defaultValue: "All",
      },
      autoWire: {
        type: "boolean",
        displayName: "Auto-wire clicks",
        description:
          "Make each row a radio — click/Enter/Space select, aria-checked + [data-active] reflect the state, no customFunction. Off → wire $ctx.currentRefinement.toggle() yourself.",
        defaultValue: true,
      },
      itemGap: {
        type: "string",
        displayName: "Item Gap",
        description:
          "Items lay out as a wrapping flex ROW (pill style) with this gap. Set inline because Plasmic strips layout styles from code-component instances.",
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
    importName: "EPSingleSelectFacet",
    parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
    providesData: true,
    refActions: {
      select: {
        description: "Select a value (replace semantics)",
        argTypes: [{ name: "value", type: "string" }],
      },
      clear: {
        description: "Clear the facet (the All affordance)",
        argTypes: [],
      },
    },
  };

export const EPSingleSelectFacet = React.forwardRef<
  EPSingleSelectFacetActions,
  EPSingleSelectFacetProps
>(function EPSingleSelectFacet(props, ref) {
  const {
    children,
    attribute,
    label,
    limit = 10,
    showMore = false,
    includeAllOption = false,
    allOptionLabel = "All",
    autoWire = true,
    itemGap = "9.5px",
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockSingleSelectFacet
        ref={ref}
        className={className}
        label={label}
        includeAllOption={includeAllOption}
        allOptionLabel={allOptionLabel}
        autoWire={autoWire}
        itemGap={itemGap}
      >
        {children}
      </MockSingleSelectFacet>
    );
  }

  return (
    <EPSingleSelectFacetInner
      ref={ref}
      attribute={attribute || "brand"}
      label={label}
      limit={limit}
      showMore={showMore}
      includeAllOption={includeAllOption}
      allOptionLabel={allOptionLabel}
      autoWire={autoWire}
      itemGap={itemGap}
      className={className}
    >
      {children}
    </EPSingleSelectFacetInner>
  );
});

/** Prepend the synthetic "All" pseudo-item (D6) when requested. */
function withAllOption(
  items: SingleSelectFacetItem[],
  includeAllOption: boolean,
  allOptionLabel: string,
  clear: () => void
): SingleSelectFacetItem[] {
  if (!includeAllOption) return items;
  const allItem: SingleSelectFacetItem = {
    value: "",
    label: allOptionLabel,
    count: undefined,
    // "All" is selected exactly when no concrete value is refined.
    isRefined: !items.some((i) => i.isRefined),
    toggle: clear,
    isAllOption: true,
  };
  return [allItem, ...items];
}

/** Pure presentational render shared by the mock and runtime wrappers (D9). */
function SingleSelectItems(props: {
  items: SingleSelectFacetItem[];
  children?: React.ReactNode;
  className?: string;
  label?: string;
  autoWire: boolean;
  itemGap: string;
}) {
  const { items, children, className, label, autoWire, itemGap } = props;

  if (items.length === 0) return null;

  return (
    <div
      className={className}
      data-ep-single-select-facet=""
      data-single-select=""
      role="radiogroup"
      aria-label={label}
    >
      {/* Inline flex-row — Plasmic strips layout styles from code-component
          instances, so the pill row is laid out here (gap via itemGap). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: itemGap }}>
        {items.map((item, i) => {
          const content = repeatedElement(i, children);
          const wired = autoWire
            ? autoWireItem(content, {
                onActivate: item.toggle,
                role: "radio",
                selected: item.isRefined,
                selectionAttr: "aria-checked",
              })
            : content;
          return (
            <div key={item.isAllOption ? "__all__" : item.value}>
              <DataProvider name="currentRefinement" data={item}>
                <DataProvider name="currentRefinementIndex" data={i}>
                  {wired}
                </DataProvider>
              </DataProvider>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MockSingleSelectFacet = React.forwardRef<
  EPSingleSelectFacetActions,
  {
    children?: React.ReactNode;
    className?: string;
    label?: string;
    includeAllOption: boolean;
    allOptionLabel: string;
    autoWire: boolean;
    itemGap: string;
  }
>(function MockSingleSelectFacet(
  { children, className, label, includeAllOption, allOptionLabel, autoWire, itemGap },
  ref
) {
  useImperativeHandle(ref, () => ({
    select: () => {},
    clear: () => {},
  }));

  const items = useMemo<SingleSelectFacetItem[]>(() => {
    const base: SingleSelectFacetItem[] = MOCK_REFINEMENT_ITEMS.map((item) => ({
      ...item,
      toggle: () => {},
      isAllOption: false,
    }));
    return withAllOption(base, includeAllOption, allOptionLabel, () => {});
  }, [includeAllOption, allOptionLabel]);

  return (
    <SingleSelectItems
      items={items}
      className={className}
      label={label}
      autoWire={autoWire}
      itemGap={itemGap}
    >
      {children}
    </SingleSelectItems>
  );
});

const EPSingleSelectFacetInner = React.forwardRef<
  EPSingleSelectFacetActions,
  {
    children?: React.ReactNode;
    attribute: string;
    label?: string;
    limit: number;
    showMore: boolean;
    includeAllOption: boolean;
    allOptionLabel: string;
    autoWire: boolean;
    itemGap: string;
    className?: string;
  }
>(function EPSingleSelectFacetInner(
  {
    children,
    attribute,
    label,
    limit,
    showMore,
    includeAllOption,
    allOptionLabel,
    autoWire,
    itemGap,
    className,
  },
  ref
) {
  const { useMenu } = require("react-instantsearch");
  const { items, refine } = useMenu({
    attribute,
    limit,
    showMore,
    // Highest-count value first (e.g. the largest scope before smaller ones);
    // name breaks ties deterministically.
    sortBy: ["count:desc", "name:asc"],
  });

  // Clearing the facet = re-selecting the currently-refined value (useMenu's
  // replace semantics toggle the refined value off, leaving nothing refined).
  const clear = React.useCallback(() => {
    const refined = (items || []).find((i: any) => i.isRefined);
    if (refined) refine(refined.value);
  }, [items, refine]);

  useImperativeHandle(ref, () => ({
    select: (value: string) => refine(value),
    clear,
  }));

  const normalizedItems = useMemo<SingleSelectFacetItem[]>(() => {
    const base: SingleSelectFacetItem[] = (items || []).map((item: any) => ({
      value: item.value,
      label: item.label,
      count: item.count,
      isRefined: item.isRefined,
      toggle: () => refine(item.value),
      isAllOption: false,
    }));
    return withAllOption(base, includeAllOption, allOptionLabel, clear);
  }, [items, refine, includeAllOption, allOptionLabel, clear]);

  return (
    <SingleSelectItems
      items={normalizedItems}
      className={className}
      label={label}
      autoWire={autoWire}
      itemGap={itemGap}
    >
      {children}
    </SingleSelectItems>
  );
});

export function registerEPSingleSelectFacet(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSingleSelectFacetProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPSingleSelectFacet,
    customMeta ?? epSingleSelectFacetMeta
  );
}
