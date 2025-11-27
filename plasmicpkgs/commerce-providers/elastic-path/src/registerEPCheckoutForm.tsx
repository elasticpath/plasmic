import React from "react";
import registerComponent from "@plasmicapp/host/registerComponent";
import { EPCheckoutForm } from "./checkout/components/EPCheckoutForm";


export const epCheckoutFormMeta = {
  name: "EPCheckoutForm",
  displayName: "Elastic Path Checkout Form",
  description: "Customer information and address collection form for Elastic Path checkout",
  importName: "EPCheckoutForm",
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  props: {
    cartId: {
      type: "string" as const,
      displayName: "Cart ID",
      description: "The cart ID to checkout",
      defaultValue: "",
    },
    apiBaseUrl: {
      type: "string" as const,
      displayName: "API Base URL",
      description: "Base URL for checkout API endpoints (defaults to /api)",
      defaultValue: "/api",
    },
    className: {
      type: "string" as const,
      displayName: "CSS Class",
      description: "CSS class name for styling",
    },
    onComplete: {
      type: "eventHandler" as const,
      displayName: "On Complete",
      description: "Called when checkout form is successfully submitted",
      argTypes: [
        {
          name: "order",
          type: "object" as const,
        },
      ],
    },
    onError: {
      type: "eventHandler" as const,
      displayName: "On Error", 
      description: "Called when an error occurs during checkout",
      argTypes: [
        {
          name: "error",
          type: "object" as const,
        },
      ],
    },
  },
  trapsFocus: true,
};

export function registerEPCheckoutForm() {
  registerComponent(EPCheckoutForm, epCheckoutFormMeta);
}