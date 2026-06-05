/**
 * EPSearchEmpty — no-results state.
 *
 * Renders only when an InstantSearch response has landed and reports zero
 * hits (`useInstantSearch().results !== null && results.nbHits === 0`).
 * That gate is deliberately stricter than `useStats().nbHits === 0`: it
 * stays silent during the SSR-to-first-response window and during error
 * states (where `results` keeps the last successful value), so designers
 * never see Empty flash on a fresh page or hide a real error behind a
 * "no results" message.
 *
 * The wrapper is `<div data-ep-search-empty role="status">`. `role="status"`
 * is implicitly an `aria-live="polite"` region per the ARIA spec, so screen
 * readers announce the slot's content when results flip from N hits to 0.
 *
 * Sibling visibility (e.g. hiding `EPSearchStats` / `EPSearchPagination`
 * when results are empty) is the designer's call. Wire `dataCond:
 * $ctx.searchStatsData.nbHits > 0` on those siblings — Empty stays
 * single-purpose and does not publish a redundant `searchIsEmpty` flag.
 *
 * Composition split (per L7 from issue #304):
 *   `EPSearchEmpty`        — top-level dispatcher (mock vs runtime branch).
 *   `MockEPSearchEmpty`    — canvas branch; renders the wrapper unconditionally.
 *   `EPSearchEmptyInner`   — runtime branch; calls `useInstantSearch()`.
 *
 * The two paths render the *same* JSX wrapper, so the headless-styling
 * contract test sees structurally equivalent leaves in editor vs runtime.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";

type PreviewState = "auto" | "withData";

interface EPSearchEmptyProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epSearchEmptyMeta: CodeComponentMeta<EPSearchEmptyProps> = {
  name: "plasmic-commerce-ep-search-empty",
  displayName: "EP Search Empty",
  section: "EP Catalog Search",
  description:
    "Shown when a search returns zero results. Stays hidden during the initial load and during error states; only renders after a real response with no hits. Wire `dataCond: $ctx.searchStatsData.nbHits > 0` on EP Search Stats / Pagination if you want them hidden alongside it. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "vbox",
          styles: {
            alignItems: "center",
            gap: "8px",
            width: "stretch",
          },
          children: [
            {
              type: "text",
              tag: "h2",
              value: "No results found",
              styles: {
                fontSize: "20px",
                fontWeight: 600,
              },
            },
            {
              type: "text",
              tag: "p",
              value:
                "Try clearing your filters or searching for something else.",
              styles: {
                fontSize: "14px",
                color: "#6b7280",
              },
            },
          ],
        },
      ],
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "`auto` renders in canvas and on real zero-result responses at runtime. `withData` pins Empty visible at runtime regardless of result count — useful for previewing the empty state while non-empty data is loaded.",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPSearchEmpty",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
};

export function EPSearchEmpty(props: EPSearchEmptyProps) {
  const { children, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockEPSearchEmpty className={className}>{children}</MockEPSearchEmpty>
    );
  }

  return (
    <EPSearchEmptyInner className={className}>{children}</EPSearchEmptyInner>
  );
}

function MockEPSearchEmpty({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      data-ep-search-empty=""
      role="status"
    >
      {children}
    </div>
  );
}

function EPSearchEmptyInner({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { useInstantSearch } = require("react-instantsearch");
  const { results } = useInstantSearch();

  // Stay silent during the SSR-to-first-response window (results === null)
  // and during error states (results keeps last successful value, which
  // could have nbHits > 0). Only render on a real zero-hit response.
  if (!results || results.nbHits !== 0) {
    return null;
  }

  return (
    <div
      className={className}
      data-ep-search-empty=""
      role="status"
    >
      {children}
    </div>
  );
}

export function registerEPSearchEmpty(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchEmptyProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchEmpty, customMeta ?? epSearchEmptyMeta);
}
