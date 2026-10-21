/**
 * Inert. It drove checkout through `/api/checkout/create-order`,
 * `/setup-payment` and `/confirm-payment`, which nothing serves, so it could
 * not place an order. It stays registered because hostless publishing rejects
 * a removed component or prop (ADR-0004). EPCheckoutSessionProvider is the
 * checkout path.
 */
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useImperativeHandle } from "react";
import { Registerable } from "../../registerable";
import { DEPRECATED_LEAD } from "../../utils/deprecated-lead";
import type { AddressData } from "../types";

type PreviewState =
  | "auto"
  | "customerInfo"
  | "shipping"
  | "payment"
  | "confirmation";

interface EPCheckoutProviderActions {
  nextStep(): void;
  previousStep(): void;
  goToStep(step: "customer_info" | "shipping" | "payment" | "confirmation"): void;
  submitCustomerInfo(data: {
    firstName: string;
    lastName: string;
    email: string;
    shippingAddress: AddressData;
    sameAsShipping: boolean;
    billingAddress?: AddressData;
  }): Promise<void>;
  submitShippingAddress(data: AddressData): void;
  submitBillingAddress(data: AddressData): void;
  selectShippingRate(rateId: string): void;
  submitPayment(): Promise<void>;
  reset(): void;
}

interface EPCheckoutProviderProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  cartId?: string;
  apiBaseUrl?: string;
  autoAdvanceSteps?: boolean;
  previewState?: PreviewState;
  className?: string;
  onComplete?: (data: { orderId: string }) => void;
}

const noop = () => {};
const asyncNoop = async () => {};

const INERT_ACTIONS: EPCheckoutProviderActions = {
  nextStep: noop,
  previousStep: noop,
  goToStep: noop,
  submitCustomerInfo: asyncNoop,
  submitShippingAddress: noop,
  submitBillingAddress: noop,
  selectShippingRate: noop,
  submitPayment: asyncNoop,
  reset: noop,
};

export const EPCheckoutProvider = React.forwardRef<
  EPCheckoutProviderActions,
  EPCheckoutProviderProps
>(function EPCheckoutProvider({ children }, ref) {
  useImperativeHandle(ref, () => INERT_ACTIONS, []);
  return <>{children}</>;
});

export const epCheckoutProviderMeta: CodeComponentMeta<EPCheckoutProviderProps> = {
  name: "plasmic-commerce-ep-checkout-provider",
  displayName: "EP Checkout Provider (deprecated)",
  description:
    "Does nothing. It called checkout routes that nothing serves, so it could not place an order. Build checkout with EP Checkout Session Provider, which takes the cart from the shopper's session. Remove this component from your project.",
  hideFromContentCreators: true,
  props: {
    children: {
      type: "slot",
    },
    loadingContent: {
      type: "slot",
      displayName: "Loading Content",
      description: `${DEPRECATED_LEAD} Nothing renders this slot.`,
      renderPropParams: [],
      hidden: () => true,
    },
    errorContent: {
      type: "slot",
      displayName: "Error Content",
      description: `${DEPRECATED_LEAD} Nothing renders this slot.`,
      renderPropParams: [],
      hidden: () => true,
    },
    cartId: {
      type: "string",
      displayName: "Cart ID",
      description:
        `${DEPRECATED_LEAD} Checkout uses the cart in the shopper's session. ` +
        "A cart id a page can set is a cart a page can take over.",
      hidden: () => true,
      advanced: true,
    },
    apiBaseUrl: {
      type: "string",
      displayName: "API Base URL",
      description: `${DEPRECATED_LEAD} Set API Base URL on EP Checkout Session Provider.`,
      hidden: () => true,
      advanced: true,
    },
    autoAdvanceSteps: {
      type: "boolean",
      displayName: "Auto-Advance Steps",
      description: DEPRECATED_LEAD,
      hidden: () => true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "customerInfo", "shipping", "payment", "confirmation"],
      displayName: "Preview State",
      description: `${DEPRECATED_LEAD} Set Preview State on EP Checkout Session Provider.`,
      hidden: () => true,
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCheckoutProvider",
  providesData: true,
  refActions: {
    nextStep: {
      displayName: "Next Step",
      description: DEPRECATED_LEAD,
      argTypes: [],
    },
    previousStep: {
      displayName: "Previous Step",
      description: DEPRECATED_LEAD,
      argTypes: [],
    },
    goToStep: {
      displayName: "Go To Step",
      description: DEPRECATED_LEAD,
      argTypes: [{ name: "step", type: "string", displayName: "Step key" }],
    },
    submitCustomerInfo: {
      displayName: "Submit Customer Info",
      description: DEPRECATED_LEAD,
      argTypes: [{ name: "data", type: "object", displayName: "Customer data" }],
    },
    submitShippingAddress: {
      displayName: "Submit Shipping Address",
      description: DEPRECATED_LEAD,
      argTypes: [{ name: "data", type: "object", displayName: "Address data" }],
    },
    submitBillingAddress: {
      displayName: "Submit Billing Address",
      description: DEPRECATED_LEAD,
      argTypes: [{ name: "data", type: "object", displayName: "Address data" }],
    },
    selectShippingRate: {
      displayName: "Select Shipping Rate",
      description: DEPRECATED_LEAD,
      argTypes: [{ name: "rateId", type: "string", displayName: "Rate ID" }],
    },
    submitPayment: {
      displayName: "Submit Payment",
      description: DEPRECATED_LEAD,
      argTypes: [],
    },
    reset: {
      displayName: "Reset Checkout",
      description: DEPRECATED_LEAD,
      argTypes: [],
    },
  },
};

export function registerEPCheckoutProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutProvider,
    customMeta ?? epCheckoutProviderMeta
  );
}
