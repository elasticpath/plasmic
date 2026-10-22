/**
 * Inert. It read the current step from EPCheckoutProvider, which is inert, so
 * it always showed the first step. It stays registered because hostless
 * publishing rejects a removed component or prop (ADR-0004).
 */
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { DEPRECATED_LEAD } from "../../utils/deprecated-lead";

type PreviewState = "auto" | "withData";

interface EPCheckoutStepIndicatorProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export function EPCheckoutStepIndicator(_props: EPCheckoutStepIndicatorProps) {
  return null;
}

export const epCheckoutStepIndicatorMeta: CodeComponentMeta<EPCheckoutStepIndicatorProps> =
  {
    name: "plasmic-commerce-ep-checkout-step-indicator",
    displayName: "EP Checkout Step Indicator (deprecated)",
    description:
      "Renders nothing. It read the step from EP Checkout Provider, which no longer runs checkout. Build checkout with EP Checkout Session Provider and show its state from $ctx.checkoutSession. Remove this component from your project.",
    hideFromContentCreators: true,
    props: {
      children: {
        type: "slot",
        description: `${DEPRECATED_LEAD} Nothing renders this slot.`,
        hidePlaceholder: true,
        hidden: () => true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        description: DEPRECATED_LEAD,
        hidden: () => true,
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutStepIndicator",
    providesData: true,
    parentComponentName: "plasmic-commerce-ep-checkout-provider",
  };

export function registerEPCheckoutStepIndicator(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutStepIndicatorProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutStepIndicator,
    customMeta ?? epCheckoutStepIndicatorMeta
  );
}
