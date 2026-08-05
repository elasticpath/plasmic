import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { useCartItemQuantity } from "./CartDrawerContext";

type PreviewState = "auto" | "enabled" | "disabled";

interface EPCartItemQuantityButtonProps {
  children?: React.ReactNode;
  className?: string;
  action: "increment" | "decrement";
  previewState?: PreviewState;
}

export const epCartItemQuantityButtonMeta: CodeComponentMeta<EPCartItemQuantityButtonProps> =
  {
    name: "plasmic-commerce-ep-cart-item-quantity-button",
    displayName: "EP Cart Item Quantity Button",
    description:
      "Increment or decrement button for cart item quantity. Must be inside an EP Cart Item Quantity Control.",
    props: {
      children: {
        type: "slot",
        defaultValue: [{ type: "text", value: "+" }],
      },
      action: {
        type: "choice",
        options: [
          { label: "Increment (+)", value: "increment" },
          { label: "Decrement (-)", value: "decrement" },
        ],
        defaultValue: "increment",
        displayName: "Action",
      },
      previewState: {
        type: "choice",
        options: ["auto", "enabled", "disabled"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCartItemQuantityButton",
  };

export function EPCartItemQuantityButton(
  props: EPCartItemQuantityButtonProps
) {
  const { children, className, action, previewState = "auto" } = props;

  const quantityCtx = useCartItemQuantity();
  const inEditor = !!usePlasmicCanvasContext();

  // Limit-reached only — do NOT native-disable while loading. Studio often
  // wraps this button in a chrome box; a native `disabled` button stops
  // receiving clicks, and subsequent clicks hit the inert wrapper instead.
  // Loading is enforced inside increment/decrement via an in-flight guard.
  const isLimitDisabled =
    previewState === "disabled"
      ? true
      : previewState === "enabled"
        ? false
        : action === "increment"
          ? !(quantityCtx?.canIncrement ?? true)
          : !(quantityCtx?.canDecrement ?? true);

  const isBusy = previewState === "auto" && !!quantityCtx?.isLoading;
  const isDisabled = isLimitDisabled;

  const handleClick = (
    e: React.MouseEvent<HTMLButtonElement> | React.MouseEvent<HTMLElement>
  ) => {
    // Clicks may land on nested text nodes from the Studio slot.
    e.preventDefault();
    e.stopPropagation();
    if (isLimitDisabled || isBusy || !quantityCtx) return;
    if (action === "increment") {
      quantityCtx.increment();
    } else {
      quantityCtx.decrement();
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={isLimitDisabled && !inEditor}
      aria-label={
        action === "increment" ? "Increase quantity" : "Decrease quantity"
      }
      aria-disabled={isDisabled || isBusy || undefined}
      aria-busy={isBusy || undefined}
      data-disabled={isDisabled || undefined}
      data-loading={isBusy || undefined}
    >
      {children}
    </button>
  );
}

export function registerEPCartItemQuantityButton(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartItemQuantityButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCartItemQuantityButton,
    customMeta ?? epCartItemQuantityButtonMeta
  );
}
