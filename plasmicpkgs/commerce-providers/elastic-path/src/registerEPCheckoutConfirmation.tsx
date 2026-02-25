import React from "react";
import registerComponent from "@plasmicapp/host/registerComponent";
import { EPCheckoutConfirmation } from "./checkout/components/EPCheckoutConfirmation";
import { Registerable } from "./registerable";


export const epCheckoutConfirmationMeta = {
  name: "EPCheckoutConfirmation", 
  displayName: "Elastic Path Checkout Confirmation",
  description: "Order confirmation page with success message and order details",
  importName: "EPCheckoutConfirmation",
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  props: {
    order: {
      type: "object" as const,
      displayName: "Order",
      description: "The completed order object to display",
    },
    showOrderSummary: {
      type: "boolean" as const,
      displayName: "Show Order Summary",
      description: "Whether to show the order summary section",
      defaultValue: true,
    },
    showPrintButton: {
      type: "boolean" as const,
      displayName: "Show Print Button",
      description: "Whether to show the print order button",
      defaultValue: true,
    },
    showContinueButton: {
      type: "boolean" as const,
      displayName: "Show Continue Button", 
      description: "Whether to show the continue shopping button",
      defaultValue: true,
    },
    customSuccessMessage: {
      type: "string" as const,
      displayName: "Custom Success Message",
      description: "Override the default success message",
    },
    className: {
      type: "string" as const,
      displayName: "CSS Class",
      description: "CSS class name for styling",
    },
    onContinueShopping: {
      type: "eventHandler" as const,
      displayName: "On Continue Shopping",
      description: "Called when the continue shopping button is clicked",
      argTypes: [],
    },
    onPrintOrder: {
      type: "eventHandler" as const,
      displayName: "On Print Order",
      description: "Called when the print order button is clicked (optional - defaults to window.print)",
      argTypes: [],
    },
  },
};

export function registerEPCheckoutConfirmation(loader?: Registerable) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCheckoutConfirmation, epCheckoutConfirmationMeta);
}