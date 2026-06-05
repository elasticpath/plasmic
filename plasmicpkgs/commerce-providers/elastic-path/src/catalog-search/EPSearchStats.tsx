/**
 * EPSearchStats — exposes search statistics (total results, query, processing time).
 *
 * Wraps `useStats()` from react-instantsearch. At design time, renders
 * children with mock stats data.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_SEARCH_STATS_DATA } from "./design-time-data";
import type { SearchStatsData } from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPSearchStatsProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epSearchStatsMeta: CodeComponentMeta<EPSearchStatsProps> = {
  name: "plasmic-commerce-ep-search-stats",
  displayName: "EP Search Stats",
  section: "EP Catalog Search",
  description:
    "Exposes search statistics (result count, query, processing time). Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: {
        type: "text",
        value: '48 results for "leather" in 12ms',
      },
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
  importName: "EPSearchStats",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
};

export function EPSearchStats(props: EPSearchStatsProps) {
  const { children, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <DataProvider name="searchStatsData" data={MOCK_SEARCH_STATS_DATA}>
        <div className={className} data-ep-search-stats="">
          {children}
        </div>
      </DataProvider>
    );
  }

  return (
    <EPSearchStatsInner className={className}>{children}</EPSearchStatsInner>
  );
}

function EPSearchStatsInner(props: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { children, className } = props;

  const { useStats } = require("react-instantsearch");
  const { nbHits, processingTimeMS, query } = useStats();

  const summary = query
    ? `${nbHits} results for "${query}" in ${processingTimeMS}ms`
    : `${nbHits} results in ${processingTimeMS}ms`;

  const statsData: SearchStatsData = {
    nbHits,
    query: query || "",
    processingTimeMS,
    summary,
  };

  return (
    <DataProvider name="searchStatsData" data={statsData}>
      <div className={className} data-ep-search-stats="">
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPSearchStats(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchStatsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchStats, customMeta ?? epSearchStatsMeta);
}
