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

  const isDisabled =
    previewState === "disabled"
      ? true
      : previewState === "enabled"
        ? false
        : action === "increment"
          ? !(quantityCtx?.canIncrement ?? true)
          : !(quantityCtx?.canDecrement ?? true);

  const handleClick = () => {
    if (isDisabled || !quantityCtx) return;
    if (action === "increment") {
      quantityCtx.increment();
    } else {
      quantityCtx.decrement();
    }
  };

  return (
    <div
      className={className}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={
        action === "increment" ? "Increase quantity" : "Decrease quantity"
      }
      aria-disabled={isDisabled}
      data-disabled={isDisabled || undefined}
    >
      {children}
    </div>
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
