import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { useBundleOption } from "./BundleContext";

type PreviewState = "auto" | "enabled" | "disabled";

interface EPBundleOptionQuantityButtonProps {
  children?: React.ReactNode;
  className?: string;
  action: "increment" | "decrement";
  previewState?: PreviewState;
}

export const epBundleOptionQuantityButtonMeta: ComponentMeta<EPBundleOptionQuantityButtonProps> =
  {
    name: "plasmic-commerce-ep-bundle-option-quantity-button",
    displayName: "EP Bundle Option Quantity Button",
    description:
      "Increment or decrement button for bundle option quantity. Must be inside an EP Bundle Option Quantity Control.",
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
    importName: "EPBundleOptionQuantityButton",
  };

export function EPBundleOptionQuantityButton(
  props: EPBundleOptionQuantityButtonProps
) {
  const { children, className, action, previewState = "auto" } = props;

  const optionCtx = useBundleOption();
  const inEditor = !!usePlasmicCanvasContext();

  const quantity = optionCtx?.quantity ?? 0;

  // Disabled state: check context for actual quantity bounds
  // The parent EPBundleOptionQuantityControl provides the min/max,
  // but this button only needs to know if it can act
  const isDisabled =
    previewState === "disabled"
      ? true
      : previewState === "enabled"
        ? false
        : !optionCtx;

  const handleClick = () => {
    if (isDisabled || !optionCtx) return;
    if (action === "increment") {
      optionCtx.setQuantity(quantity + 1);
    } else {
      optionCtx.setQuantity(Math.max(0, quantity - 1));
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
        action === "increment"
          ? "Increase option quantity"
          : "Decrease option quantity"
      }
      aria-disabled={isDisabled}
      data-disabled={isDisabled || undefined}
    >
      {children}
    </div>
  );
}

export function registerEPBundleOptionQuantityButton(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleOptionQuantityButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleOptionQuantityButton,
    customMeta ?? epBundleOptionQuantityButtonMeta
  );
}
