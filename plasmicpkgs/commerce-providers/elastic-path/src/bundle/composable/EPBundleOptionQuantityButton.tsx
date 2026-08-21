import {
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
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

export const epBundleOptionQuantityButtonMeta: CodeComponentMeta<EPBundleOptionQuantityButtonProps> =
  {
    name: "plasmic-commerce-ep-bundle-option-quantity-button",
    displayName: "EP Bundle Option Quantity Button",
    description:
      "Increment or decrement button for bundle option quantity. Must be inside an EP Bundle Option Quantity Control.",
    props: {
      children: {
        type: "slot",
        description:
          "Optional. Leave empty for the glyph matching this button's action; fill it to supply your own.",
        hidePlaceholder: true,
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
    parentComponentName: "plasmic-commerce-ep-bundle-option-quantity-control",
  };

export function EPBundleOptionQuantityButton(
  props: EPBundleOptionQuantityButtonProps
) {
  const { children, className, action, previewState = "auto" } = props;

  const optionCtx = useBundleOption();
  const currentOption = useSelector("currentBundleOption") as
    | { minQty?: number | null; maxQty?: number | null }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const quantity = optionCtx?.quantity ?? 0;
  const min = currentOption?.minQty ?? 0;
  const max = currentOption?.maxQty ?? 99;

  // Disabled state: enforce min/max bounds from the option data
  const isDisabled =
    previewState === "disabled"
      ? true
      : previewState === "enabled"
        ? false
        : !optionCtx ||
          (action === "increment" && quantity >= max) ||
          (action === "decrement" && quantity <= min);

  const handleClick = () => {
    if (isDisabled || !optionCtx) return;
    if (action === "increment") {
      optionCtx.setQuantity(Math.min(max, quantity + 1));
    } else {
      optionCtx.setQuantity(Math.max(min, quantity - 1));
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
      {children ?? (
        // The slot default was "+" for both directions, so a decrement
        // button dropped in as-is read "+". The glyph follows `action`.
        <span data-ep-quantity-glyph="">
          {action === "increment" ? "+" : "\u2212"}
        </span>
      )}
    </div>
  );
}

export function registerEPBundleOptionQuantityButton(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPBundleOptionQuantityButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleOptionQuantityButton,
    customMeta ?? epBundleOptionQuantityButtonMeta
  );
}
