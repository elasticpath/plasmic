/**
 * EPRefinementList — facet filter list for catalog search.
 *
 * Wraps `useRefinementList()` from react-instantsearch. Headless — exposes
 * refinement items for designer to render with any Plasmic elements.
 * Supports toggleRefinement action via refActions.
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
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockRefinementList ref={ref} className={className} label={label}>
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
      className={className}
    >
      {children}
    </EPRefinementListInner>
  );
});

const MockRefinementList = React.forwardRef<
  EPRefinementListActions,
  { children?: React.ReactNode; className?: string; label?: string }
>(function MockRefinementList({ children, className, label }, ref) {
  useImperativeHandle(ref, () => ({
    toggleRefinement: () => {},
  }));

  return (
    <div className={className} data-ep-refinement-list="" aria-label={label}>
      <div role="list">
        {MOCK_REFINEMENT_ITEMS.map((item, i) => (
          <div key={item.value} role="listitem">
            <DataProvider name="currentRefinement" data={item}>
              <DataProvider name="currentRefinementIndex" data={i}>
                {repeatedElement(i, children)}
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
                {repeatedElement(i, children)}
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
