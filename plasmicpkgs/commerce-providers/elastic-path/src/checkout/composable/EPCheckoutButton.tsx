/**
 * EPCheckoutButton — a "Checkout" control that goes to the checkout page.
 * Exposes `checkoutButtonData` via DataProvider for label binding.
 */
import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
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
  checkoutUrl?: string;
}

interface CheckoutButtonData {
  label: string;
  isDisabled: boolean;
  isProcessing: boolean;
  step: string;
}

// ---------------------------------------------------------------------------
// Step → label mapping (editor preview only)
// ---------------------------------------------------------------------------
const STEP_LABELS: Record<string, string> = {
  customer_info: "Continue to Shipping",
  shipping: "Continue to Payment",
  payment: "Place Order",
  confirmation: "Done",
};

const CHECKOUT_DATA: CheckoutButtonData = {
  label: "Checkout",
  isDisabled: false,
  isProcessing: false,
  step: "cart",
};

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
  const {
    children,
    className,
    previewState = "auto",
    checkoutUrl = "/checkout",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock = inEditor && previewState !== "auto";

  const buttonData = useMemo<CheckoutButtonData>(
    () =>
      useMock
        ? mockForStep(
            previewState === "customerInfo" ? "customer_info" : previewState
          )
        : CHECKOUT_DATA,
    [useMock, previewState]
  );

  const handleClick = useCallback(() => {
    if (inEditor) return;
    if (typeof window !== "undefined" && checkoutUrl) {
      window.location.assign(checkoutUrl);
    }
  }, [inEditor, checkoutUrl]);

  return (
    <DataProvider name="checkoutButtonData" data={buttonData}>
      <div
        className={className}
        data-ep-checkout-button=""
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {children ?? (
          <span data-ep-checkout-button-label="">{buttonData.label}</span>
        )}
      </div>
    </DataProvider>
  );
}

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCheckoutButtonMeta: CodeComponentMeta<EPCheckoutButtonProps> = {
  name: "plasmic-commerce-ep-checkout-button",
  displayName: "EP Checkout Button",
  description:
    "Goes to the checkout page when clicked. Bind any content to checkoutButtonData.label.",
  props: {
    children: {
      type: "slot",
      description:
        "Optional. Leave empty for the \"Checkout\" label; fill it to compose your own against checkoutButtonData.",
      hidePlaceholder: true,
    },
    checkoutUrl: {
      type: "string",
      displayName: "Checkout URL",
      description:
        "The checkout page the button goes to.",
      defaultValue: "/checkout",
    },
    onComplete: {
      type: "eventHandler",
      displayName: "On Complete",
      description:
        "Deprecated — ignored. It fired only on EP Checkout Provider's confirmation step, which no longer exists.",
      argTypes: [
        {
          name: "data",
          type: "object",
        },
      ],
      hidden: () => true,
      advanced: true,
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
      description:
        "Editor only. Shows a checkout step's label on the canvas. Auto shows \"Checkout\", as the published page always does.",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCheckoutButton",
  providesData: true,
};

export function registerEPCheckoutButton(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutButton,
    customMeta ?? epCheckoutButtonMeta
  );
}
