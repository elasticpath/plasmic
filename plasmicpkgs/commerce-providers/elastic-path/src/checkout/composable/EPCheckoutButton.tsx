/**
 * EPCheckoutButton — step-aware submit/advance button.
 *
 * Derives its label and click behaviour from the current checkout step.
 * On steps 0–1 (Customer Info, Shipping) → nextStep().
 * On step 2 (Payment) → submitPayment().
 * On step 3 (Confirmation) → fires onComplete event.
 *
 * The designer slots any content inside and styles freely. The component
 * exposes `checkoutButtonData` via DataProvider so children can bind to
 * the dynamic label, disabled state, and processing state.
 */
import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useMemo } from "react";
import { Registerable } from "../../registerable";

// ---------------------------------------------------------------------------
// Step → label mapping
// ---------------------------------------------------------------------------
const STEP_LABELS: Record<string, string> = {
  customer_info: "Continue to Shipping",
  shipping: "Continue to Payment",
  payment: "Place Order",
  confirmation: "Done",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "customerInfo" | "shipping" | "payment" | "confirmation";

interface EPCheckoutButtonProps {
  children?: React.ReactNode;
  onComplete?: (data: { orderId: string }) => void;
  className?: string;
  previewState?: PreviewState;
}

interface CheckoutButtonData {
  label: string;
  isDisabled: boolean;
  isProcessing: boolean;
  step: string;
}

// ---------------------------------------------------------------------------
// Map previewState to step key
// ---------------------------------------------------------------------------
const PREVIEW_TO_STEP: Record<string, string> = {
  customerInfo: "customer_info",
  shipping: "shipping",
  payment: "payment",
  confirmation: "confirmation",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EPCheckoutButton(props: EPCheckoutButtonProps) {
  const {
    children,
    onComplete,
    className,
    previewState = "auto",
  } = props;

  const checkoutData = useSelector("checkoutData") as
    | {
        step?: string;
        canProceed?: boolean;
        isProcessing?: boolean;
        order?: { id: string } | null;
      }
    | undefined;

  const inEditor = !!usePlasmicCanvasContext();

  // Determine current step
  const step = useMemo(() => {
    if (previewState !== "auto") {
      return PREVIEW_TO_STEP[previewState] ?? "customer_info";
    }
    if (inEditor && !checkoutData?.step) {
      return "customer_info";
    }
    return checkoutData?.step ?? "customer_info";
  }, [previewState, inEditor, checkoutData?.step]);

  const label = STEP_LABELS[step] ?? "Continue";
  const isProcessing = checkoutData?.isProcessing ?? false;
  const canProceed = checkoutData?.canProceed ?? false;

  // In editor, never disable so designers can style both states
  const isDisabled = inEditor ? false : (!canProceed || isProcessing);

  const buttonData = useMemo<CheckoutButtonData>(
    () => ({
      label,
      isDisabled,
      isProcessing,
      step,
    }),
    [label, isDisabled, isProcessing, step]
  );

  // onClick is handled via Plasmic interactions wired to EPCheckoutProvider
  // refActions (nextStep, submitPayment, etc.). The onComplete event handler
  // is for the confirmation step — fired when the designer wires this button's
  // onClick to call onComplete.
  const handleClick = useCallback(() => {
    if (step === "confirmation" && onComplete && checkoutData?.order?.id) {
      onComplete({ orderId: checkoutData.order.id });
    }
  }, [step, onComplete, checkoutData?.order?.id]);

  return (
    <DataProvider name="checkoutButtonData" data={buttonData}>
      <div
        className={className}
        data-ep-checkout-button=""
        data-step={step}
        data-processing={isProcessing || undefined}
        onClick={handleClick}
        role="button"
        aria-disabled={isDisabled}
      >
        {children}
      </div>
    </DataProvider>
  );
}

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCheckoutButtonMeta: ComponentMeta<EPCheckoutButtonProps> = {
  name: "plasmic-commerce-ep-checkout-button",
  displayName: "EP Checkout Button",
  description:
    "Step-aware submit/advance button. Derives label from current checkout step. Wire onClick to EPCheckoutProvider refActions (nextStep or submitPayment).",
  props: {
    children: {
      type: "slot",
      defaultValue: [{ type: "text", value: "Continue" }],
    },
    onComplete: {
      type: "eventHandler" as const,
      argTypes: [{ name: "data", type: "object" }],
    },
    previewState: {
      type: "choice",
      options: ["auto", "customerInfo", "shipping", "payment", "confirmation"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCheckoutButton",
  providesData: true,
};

export function registerEPCheckoutButton(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCheckoutButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCheckoutButton, customMeta ?? epCheckoutButtonMeta);
}
