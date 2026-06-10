/**
 * EPPlaceOrderButton — self-wiring submit button for the single-page checkout.
 *
 * Reads the shared checkout form via useCheckoutForm() and, on click, runs
 * the chosen `action`:
 *   - "placeOrder" (default): validates then places the order.
 *   - "validate": validates only (use for an intermediate "Save" button).
 * No Plasmic interaction wiring needed — its onClick calls into the
 * provider context directly.
 *
 * DOM hook: [data-ep-place-order]. Disabled + relabelled while placing.
 */
import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { useCheckoutForm } from "./EPCheckoutFormProvider";

interface EPPlaceOrderButtonProps {
  className?: string;
  label?: string;
  placingLabel?: string;
  action?: "placeOrder" | "validate";
}

export function EPPlaceOrderButton(props: EPPlaceOrderButtonProps) {
  const {
    className,
    label = "Place your order",
    placingLabel = "Placing order…",
    action = "placeOrder",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const form = useCheckoutForm();
  const isPlacing = form.status === "placing";

  const handleClick = () => {
    if (inEditor) return;
    if (action === "validate") {
      form.validateAll();
    } else {
      void form.placeOrder();
    }
  };

  return (
    <button
      type="button"
      className={className}
      data-ep-place-order=""
      data-ep-action={action}
      disabled={isPlacing}
      onClick={handleClick}
    >
      {isPlacing ? placingLabel : label}
    </button>
  );
}

export const epPlaceOrderButtonMeta: CodeComponentMeta<EPPlaceOrderButtonProps> =
  {
    name: "plasmic-commerce-ep-place-order-button",
    displayName: "EP Place Order Button",
    description:
      "Self-wiring checkout submit button. Inside an EP Checkout Form Provider, places the order (or validates only) on click — no interaction wiring needed.",
    props: {
      label: { type: "string", defaultValue: "Place your order" },
      placingLabel: {
        type: "string",
        defaultValue: "Placing order…",
        displayName: "Placing Label",
      },
      action: {
        type: "choice",
        options: ["placeOrder", "validate"],
        defaultValue: "placeOrder",
        description:
          '"placeOrder" submits the order; "validate" only checks the form (use for a Save button).',
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPPlaceOrderButton",
  };

export function registerEPPlaceOrderButton(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPPlaceOrderButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPPlaceOrderButton, customMeta ?? epPlaceOrderButtonMeta);
}
