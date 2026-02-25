import React from "react";
import registerComponent from "@plasmicapp/host/registerComponent";
import { EPOrderSummary } from "./checkout/components/EPOrderSummary";
import { Registerable } from "./registerable";


export const epOrderSummaryMeta = {
  name: "EPOrderSummary",
  displayName: "Elastic Path Order Summary",
  description: "Displays order details including items, pricing, and customer information",
  importName: "EPOrderSummary",
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  props: {
    order: {
      type: "object" as const,
      displayName: "Order",
      description: "The order object to display",
    },
    showTitle: {
      type: "boolean" as const,
      displayName: "Show Title",
      description: "Whether to show the 'Order Summary' title",
      defaultValue: true,
    },
    showItems: {
      type: "boolean" as const, 
      displayName: "Show Items",
      description: "Whether to show the order items list",
      defaultValue: true,
    },
    showCustomer: {
      type: "boolean" as const,
      displayName: "Show Customer",
      description: "Whether to show customer information",
      defaultValue: true,
    },
    showAddresses: {
      type: "boolean" as const,
      displayName: "Show Addresses", 
      description: "Whether to show billing and shipping addresses",
      defaultValue: true,
    },
    compact: {
      type: "boolean" as const,
      displayName: "Compact Mode",
      description: "Use compact layout with minimal details",
      defaultValue: false,
    },
    className: {
      type: "string" as const,
      displayName: "CSS Class",
      description: "CSS class name for styling",
    },
  },
};

export function registerEPOrderSummary(loader?: Registerable) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPOrderSummary, epOrderSummaryMeta);
}