/**
 * EPCurrentRefinements — chip row showing each active refinement.
 *
 * Wraps `useCurrentRefinements()` from react-instantsearch. The hook returns
 * data nested per-attribute; this component flattens into one chip per
 * (attribute, value) pair. Each repeated child gets `onClick` injected via
 * Pattern C (cloneElement) so dismissing a chip works without Studio
 * interaction wiring. The per-iteration `currentRefinementChip` ctx value
 * carries a zero-arg `refine` for designers whose layout breaks
 * auto-injection.
 *
 * Returns null when there are no refinements — no empty band above the grid.
 */

import {
  DataProvider,
  repeatedElement,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../registerable";
import {
  MOCK_CURRENT_REFINEMENT_CHIPS,
  CurrentRefinementChip,
  CurrentRefinementType,
} from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPCurrentRefinementsProps {
  children?: React.ReactNode;
  includedAttributes?: string[];
  excludedAttributes?: string[];
  className?: string;
  previewState?: PreviewState;
}

export const epCurrentRefinementsMeta: CodeComponentMeta<EPCurrentRefinementsProps> = {
  name: "plasmic-commerce-ep-current-refinements",
  displayName: "EP Current Refinements",
  description:
    "Chip row showing each active filter. Repeats children per refinement; click dismisses that refinement automatically. Hides itself when no filters are active. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "hbox",
          styles: {
            alignItems: "center",
            gap: "4px",
            paddingTop: "4px",
            paddingRight: "8px",
            paddingBottom: "4px",
            paddingLeft: "8px",
            borderTopLeftRadius: "999px",
            borderTopRightRadius: "999px",
            borderBottomLeftRadius: "999px",
            borderBottomRightRadius: "999px",
            borderTopWidth: "1px",
            borderRightWidth: "1px",
            borderBottomWidth: "1px",
            borderLeftWidth: "1px",
            borderTopStyle: "solid",
            borderRightStyle: "solid",
            borderBottomStyle: "solid",
            borderLeftStyle: "solid",
            borderTopColor: "#d1d5db",
            borderRightColor: "#d1d5db",
            borderBottomColor: "#d1d5db",
            borderLeftColor: "#d1d5db",
          },
          children: [
            { type: "text", value: "Brand: Leather" },
            { type: "text", value: "×" },
          ],
        },
      ],
    },
    includedAttributes: {
      type: "array",
      displayName: "Included Attributes",
      description:
        "Restrict which attributes appear as chips. Mutually exclusive with Excluded Attributes.",
    },
    excludedAttributes: {
      type: "array",
      displayName: "Excluded Attributes",
      description:
        "Attributes to omit from the chip row. Defaults to ['query'] in react-instantsearch when unset.",
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
  importName: "EPCurrentRefinements",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
};

interface RawRefinement {
  attribute: string;
  type: CurrentRefinementType;
  value: string | number;
  label: string;
  operator?: string;
  count?: number;
}

interface RawCurrentRefinementsItem {
  attribute: string;
  label: string;
  refinements: RawRefinement[];
  refine: (refinement: RawRefinement) => void;
}

export function EPCurrentRefinements(props: EPCurrentRefinementsProps) {
  const {
    children,
    includedAttributes,
    excludedAttributes,
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockCurrentRefinements className={className}>
        {children}
      </MockCurrentRefinements>
    );
  }

  return (
    <EPCurrentRefinementsInner
      includedAttributes={includedAttributes}
      excludedAttributes={excludedAttributes}
      className={className}
    >
      {children}
    </EPCurrentRefinementsInner>
  );
}

function MockCurrentRefinements({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      data-ep-current-refinements=""
      role="list"
    >
      {MOCK_CURRENT_REFINEMENT_CHIPS.map((chip, i) => (
        <div
          key={`${chip.attribute}:${chip.value}`}
          role="listitem"
          onClick={chip.refine}
        >
          <DataProvider name="currentRefinementChip" data={chip}>
            <DataProvider name="currentRefinementChipIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

function EPCurrentRefinementsInner({
  children,
  includedAttributes,
  excludedAttributes,
  className,
}: {
  children?: React.ReactNode;
  includedAttributes?: string[];
  excludedAttributes?: string[];
  className?: string;
}) {
  const { useCurrentRefinements } = require("react-instantsearch");
  const { items } = useCurrentRefinements({
    includedAttributes,
    excludedAttributes,
  }) as { items: RawCurrentRefinementsItem[] };

  const chips: CurrentRefinementChip[] = useMemo(() => {
    const flattened: CurrentRefinementChip[] = [];
    for (const item of items || []) {
      for (const refinement of item.refinements || []) {
        flattened.push({
          attribute: refinement.attribute,
          attributeLabel: item.label,
          type: refinement.type,
          value: refinement.value,
          label: refinement.label,
          operator: refinement.operator,
          count: refinement.count,
          refine: () => item.refine(refinement),
        });
      }
    }
    return flattened;
  }, [items]);

  if (chips.length === 0) return null;

  return (
    <div className={className} data-ep-current-refinements="" role="list">
      {chips.map((chip, i) => (
        <div
          key={`${chip.attribute}:${chip.value}`}
          role="listitem"
          onClick={chip.refine}
        >
          <DataProvider name="currentRefinementChip" data={chip}>
            <DataProvider name="currentRefinementChipIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPCurrentRefinements(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCurrentRefinementsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCurrentRefinements,
    customMeta ?? epCurrentRefinementsMeta
  );
}
