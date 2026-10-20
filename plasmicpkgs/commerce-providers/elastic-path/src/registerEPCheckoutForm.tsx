import registerComponent from "@plasmicapp/host/registerComponent";
import { EPCheckoutForm } from "./checkout/components/EPCheckoutForm";
import { Registerable } from "./registerable";
import { DEPRECATED_LEAD } from "./utils/deprecated-lead";

export const epCheckoutFormMeta = {
  name: "EPCheckoutForm",
  displayName: "Elastic Path Checkout Form (deprecated)",
  description:
    "Renders nothing. It called a checkout route that nothing serves, so it could not place an order. Build checkout with EP Checkout Session Provider. Remove this component from your project.",
  hideFromContentCreators: true,
  importName: "EPCheckoutForm",
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  props: {
    cartId: {
      type: "string" as const,
      displayName: "Cart ID",
      description: `${DEPRECATED_LEAD} Checkout uses the cart in the shopper's session.`,
      hidden: () => true,
    },
    apiBaseUrl: {
      type: "string" as const,
      displayName: "API Base URL",
      description: `${DEPRECATED_LEAD} Set API Base URL on EP Checkout Session Provider.`,
      defaultValue: "/api",
      hidden: () => true,
    },
    className: {
      type: "string" as const,
      displayName: "CSS Class",
      description: DEPRECATED_LEAD,
      hidden: () => true,
    },
    onComplete: {
      type: "eventHandler" as const,
      displayName: "On Complete",
      description: `${DEPRECATED_LEAD} It never fires.`,
      argTypes: [
        {
          name: "order",
          type: "object" as const,
        },
      ],
      hidden: () => true,
      advanced: true,
    },
    onError: {
      type: "eventHandler" as const,
      displayName: "On Error",
      description: `${DEPRECATED_LEAD} It never fires.`,
      argTypes: [
        {
          name: "error",
          type: "object" as const,
        },
      ],
      hidden: () => true,
      advanced: true,
    },
  },
  trapsFocus: true,
};

export function registerEPCheckoutForm(loader?: Registerable) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCheckoutForm, epCheckoutFormMeta);
}
