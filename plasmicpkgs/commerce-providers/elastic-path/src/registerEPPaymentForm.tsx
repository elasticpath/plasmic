import React from "react";
import registerComponent from "@plasmicapp/host/registerComponent";
import { EPPaymentForm } from "./checkout/components/EPPaymentForm";


export const epPaymentFormMeta = {
  name: "EPPaymentForm",
  displayName: "Elastic Path Payment Form",
  description: "Stripe payment form for Elastic Path orders with secure payment processing",
  importName: "EPPaymentForm",
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  props: {
    order: {
      type: "object" as const,
      displayName: "Order",
      description: "The order object to process payment for",
    },
    stripePublishableKey: {
      type: "string" as const,
      displayName: "Stripe Publishable Key",
      description: "Your Stripe publishable key (pk_...)",
      defaultValue: "",
    },
    apiBaseUrl: {
      type: "string" as const,
      displayName: "API Base URL", 
      description: "Base URL for checkout API endpoints (defaults to /api)",
      defaultValue: "/api",
    },
    theme: {
      type: "choice" as const,
      displayName: "Stripe Theme",
      description: "Visual theme for Stripe Elements",
      options: ["stripe", "night", "flat"],
      defaultValue: "stripe",
    },
    className: {
      type: "string" as const,
      displayName: "CSS Class",
      description: "CSS class name for styling",
    },
    onSuccess: {
      type: "eventHandler" as const,
      displayName: "On Success",
      description: "Called when payment is successfully completed",
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
      description: "Called when payment fails or encounters an error",
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

export function registerEPPaymentForm() {
  registerComponent(EPPaymentForm, epPaymentFormMeta);
}