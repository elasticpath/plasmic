import { DataProvider, repeatedElement } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { useStockContext } from "./StockContext";
import { createLogger } from "../utils/logger";

interface EPLocationListProps {
  children?: React.ReactNode;
  className?: string;
  maxLocations?: number;
  emptyContent?: React.ReactNode;
}

export const epLocationListMeta: ComponentMeta<EPLocationListProps> = {
  name: "plasmic-commerce-ep-location-list",
  displayName: "EP Location List",
  description:
    "Repeats children for each location with stock. Design your location card and it will be repeated for every location. Must be placed inside an EP Stock Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-location-picker",
        },
      ],
    },
    maxLocations: {
      type: "number",
      defaultValue: 10,
      displayName: "Max Locations",
      description: "Maximum number of locations to display",
    },
    emptyContent: {
      type: "slot",
      displayName: "Empty Content",
      defaultValue: {
        type: "text",
        value: "No locations available",
      },
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPLocationList",
  providesData: true,
};

const log = createLogger("EPLocationList");

export function EPLocationList(props: EPLocationListProps) {
  const { children, className, maxLocations = 10, emptyContent } = props;

  const stockCtx = useStockContext();
  const stockLocations = stockCtx?.stockLocations;

  log.debug("Rendering", {
    hasContext: !!stockCtx,
    stockLocationsCount: stockLocations?.length,
  } as Record<string, unknown>);

  if (!stockLocations || stockLocations.length === 0) {
    return <div className={className}>{emptyContent}</div>;
  }

  const displayedLocations = stockLocations.slice(0, maxLocations);

  return (
    <div className={className}>
      {displayedLocations.map((location, i) => (
        <DataProvider key={location.slug} name="currentLocation" data={location}>
          <DataProvider name="currentLocationIndex" data={i}>
            {repeatedElement(i, children)}
          </DataProvider>
        </DataProvider>
      ))}
    </div>
  );
}

export function registerEPLocationList(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPLocationListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPLocationList, customMeta ?? epLocationListMeta);
}
