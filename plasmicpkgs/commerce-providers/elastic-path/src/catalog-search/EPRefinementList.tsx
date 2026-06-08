/**
 * EPRefinementList — multi-select facet filter list for catalog search.
 *
 * Wraps `useRefinementList()` from react-instantsearch. Headless — exposes one
 * refinement item per value to the slot; the designer styles the row. Selecting
 * a value OR-combines it with the others (a multi-select facet, e.g. Brand,
 * Color, Material).
 *
 * Auto-wiring (D2, default on) makes each slotted row a toggle button: click +
 * Enter/Space refine, `aria-pressed`/`[data-active]` reflect the refined state,
 * all without a `customFunction`. Turn it off (`autoWire={false}`) for
 * byte-for-byte the prior behaviour — the per-item `toggle` stays on context.
 *
 * For radio-style "pick one" facets (a single-choice scope filter), use
 * EPSingleSelectFacet instead — the per-item context is identical, so slot
 * content ports across the two.
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

/** Per-item context published to the slot (shared with EPSingleSelectFacet). */
export interface NormalizedRefinementItem {
  value: string;
  label: string;
  count: number;
  isRefined: boolean;
  toggle: () => void;
}

interface EPRefinementListProps {
  children?: React.ReactNode;
  attribute?: string;
  label?: string;
  limit?: number;
  showMore?: boolean;
  searchable?: boolean;
  autoWire?: boolean;
  className?: string;
  previewState?: PreviewState;
}

interface EPRefinementListActions {
  toggleRefinement(value: string): void;
}

export const epRefinementListMeta: CodeComponentMeta<EPRefinementListProps> = {
  name: "plasmic-commerce-ep-refinement-list",
  displayName: "EP Refinement List",
  section: "EP Catalog Search",
  description:
    "Multi-select facet filter (e.g., Brand, Color, Material). Repeats children for each value; clicking a row toggles it (auto-wired by default). For a single-choice scope filter use EP Single Select Facet. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "hbox",
          children: [
            { type: "text", value: "Filter Value" },
            { type: "text", value: "(0)" },
          ],
        },
      ],
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
    autoWire: {
      type: "boolean",
      displayName: "Auto-wire clicks",
      description:
        "Make each row a toggle button — click/Enter/Space refine, aria-pressed + [data-active] reflect the refined state, no customFunction needed. Turn off to wire $ctx.currentRefinement.toggle() yourself (prior behaviour).",
      defaultValue: true,
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
    autoWire = true,
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
        autoWire={autoWire}
      >
        {children}
      </MockRefinementList>
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
      autoWire={autoWire}
      className={className}
    >
      {children}
    </EPRefinementListInner>
  );
});

/**
 * Pure presentational render shared by the mock and runtime wrappers (#305
 * contract, D9): one render path, so the canvas DOM tree matches the browser.
 */
function RefinementItems(props: {
  items: NormalizedRefinementItem[];
  children?: React.ReactNode;
  className?: string;
  label?: string;
  autoWire: boolean;
}) {
  const { items, children, className, label, autoWire } = props;

  if (items.length === 0) return null;

  return (
    <div className={className} data-ep-refinement-list="" aria-label={label}>
      <div role="list">
        {items.map((item, i) => {
          const content = repeatedElement(i, children);
          const wired = autoWire
            ? autoWireItem(content, {
                onActivate: item.toggle,
                role: "button",
                selected: item.isRefined,
                selectionAttr: "aria-pressed",
              })
            : content;
          return (
            <div key={item.value} role="listitem">
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

const MockRefinementList = React.forwardRef<
  EPRefinementListActions,
  {
    children?: React.ReactNode;
    className?: string;
    label?: string;
    autoWire: boolean;
  }
>(function MockRefinementList({ children, className, label, autoWire }, ref) {
  useImperativeHandle(ref, () => ({
    toggleRefinement: () => {},
  }));

  const items = useMemo<NormalizedRefinementItem[]>(
    () => MOCK_REFINEMENT_ITEMS.map((item) => ({ ...item, toggle: () => {} })),
    []
  );

  return (
    <RefinementItems
      items={items}
      className={className}
      label={label}
      autoWire={autoWire}
    >
      {children}
    </RefinementItems>
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
    autoWire: boolean;
    className?: string;
  }
>(function EPRefinementListInner(
  { children, attribute, label, limit, showMore, searchable, autoWire, className },
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

  // `toggle` rides along on the per-item context so a designer can wire a click
  // via customFunction when auto-wiring is off — the Tier-1 escape.
  const normalizedItems = useMemo<NormalizedRefinementItem[]>(
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

  return (
    <RefinementItems
      items={normalizedItems}
      className={className}
      label={label}
      autoWire={autoWire}
    >
      {children}
    </RefinementItems>
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
