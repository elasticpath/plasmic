/**
 * Inert. It took its client secret only from EPCheckoutProvider, which is
 * inert, so it could never mount a card form. It stays registered because
 * hostless publishing rejects a removed component or prop (ADR-0004).
 * EPStripePayment is the card form.
 */
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { DEPRECATED_LEAD } from "../../utils/deprecated-lead";

type PreviewState = "auto" | "ready" | "processing" | "error";

interface EPPaymentElementsProps {
  children?: React.ReactNode;
  stripePublishableKey?: string;
  appearance?: Record<string, any>;
  className?: string;
  previewState?: PreviewState;
}

export function EPPaymentElements({ children }: EPPaymentElementsProps) {
  return <>{children}</>;
}

export const epPaymentElementsMeta: CodeComponentMeta<EPPaymentElementsProps> = {
  name: "plasmic-commerce-ep-payment-elements",
  displayName: "EP Payment Elements (deprecated)",
  description:
    "Does nothing. It needed EP Checkout Provider, which no longer runs checkout, so it could not show a card form. Use EP Stripe Payment inside EP Checkout Session Provider. Remove this component from your project.",
  hideFromContentCreators: true,
  props: {
    children: {
      type: "slot",
    },
    stripePublishableKey: {
      type: "string",
      displayName: "Stripe Publishable Key",
      description: `${DEPRECATED_LEAD} Set the key on EP Stripe Payment.`,
      hidden: () => true,
    },
    appearance: {
      type: "object",
      displayName: "Stripe Appearance",
      description: `${DEPRECATED_LEAD} Set the appearance on EP Stripe Payment.`,
      hidden: () => true,
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "ready", "processing", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description: DEPRECATED_LEAD,
      hidden: () => true,
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPPaymentElements",
  providesData: true,
};

export function registerEPPaymentElements(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPPaymentElementsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPPaymentElements,
    customMeta ?? epPaymentElementsMeta
  );
}
