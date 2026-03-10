/**
 * EPCheckoutButton — step-aware submit/advance button.
 *
 * Derives its label and behaviour from the current checkout step.
 * The designer slots any content inside and styles freely. Exposes
 * `checkoutButtonData` via DataProvider for label/state binding.
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
// Types
// ---------------------------------------------------------------------------
type PreviewState =
  | "auto"
  | "customerInfo"
  | "shipping"
  | "payment"
  | "confirmation";

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
// Step → label mapping
// ---------------------------------------------------------------------------
const STEP_LABELS: Record<string, string> = {
  customer_info: "Continue to Shipping",
  shipping: "Continue to Payment",
  payment: "Place Order",
  confirmation: "Done",
};

// ---------------------------------------------------------------------------
// Mock map for design-time
// ---------------------------------------------------------------------------
function mockForStep(step: string): CheckoutButtonData {
  return {
    label: STEP_LABELS[step] ?? "Continue",
    isDisabled: false,
    isProcessing: false,
    step,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EPCheckoutButton(props: EPCheckoutButtonProps) {
  const { children, onComplete, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // Read from parent EPCheckoutProvider
  const checkoutData = useSelector("checkoutData") as
    | {
        step?: string;
        canProceed?: boolean;
        isProcessing?: boolean;
        order?: { id: string } | null;
      }
    | undefined;

  const step = checkoutData?.step ?? "customer_info";
  const canProceed = checkoutData?.canProceed ?? false;
  const isProcessing = checkoutData?.isProcessing ?? false;

  // Design-time preview
  const useMock =
    (previewState !== "auto") ||
    (inEditor && !checkoutData);

  const buttonData = useMemo<CheckoutButtonData>(() => {
    if (useMock) {
      const previewStep =
        previewState !== "auto" ? previewState : "customerInfo";
      // Map previewState camelCase to step key
      const stepKey =
        previewStep === "customerInfo"
          ? "customer_info"
          : previewStep;
      return mockForStep(stepKey);
    }

    return {
      label: STEP_LABELS[step] ?? "Continue",
      isDisabled: isProcessing || !canProceed,
      isProcessing,
      step,
    };
  }, [useMock, previewState, step, canProceed, isProcessing]);

  const handleClick = useCallback(() => {
    if (inEditor) return; // No action in editor
    if (buttonData.isDisabled) return;

    // The actual action is triggered via Plasmic interactions on the parent
    // EPCheckoutProvider's refActions. This component just provides data.
    // However, on the confirmation step, fire onComplete.
    if (step === "confirmation" && checkoutData?.order) {
      onComplete?.({ orderId: checkoutData.order.id });
    }
  }, [inEditor, buttonData.isDisabled, step, checkoutData?.order, onComplete]);

  return (
    <DataProvider name="checkoutButtonData" data={buttonData}>
      <div
        className={className}
        data-ep-checkout-button=""
        data-processing={isProcessing || undefined}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-disabled={buttonData.isDisabled || undefined}
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
    "Step-aware checkout button that derives its label from the current step. Bind any content to checkoutButtonData.label.",
  props: {
    children: {
      type: "slot",
      defaultValue: [{ type: "text", value: "Continue" }],
    },
    onComplete: {
      type: "eventHandler",
      displayName: "On Complete",
      argTypes: [
        {
          name: "data",
          type: "object",
        },
      ],
    } as any,
    previewState: {
      type: "choice",
      options: [
        "auto",
        "customerInfo",
        "shipping",
        "payment",
        "confirmation",
      ],
      defaultValue: "auto",
      displayName: "Preview State",
      description: "Force a preview state for design-time editing",
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
  doRegisterComponent(
    EPCheckoutButton,
    customMeta ?? epCheckoutButtonMeta
  );
}
