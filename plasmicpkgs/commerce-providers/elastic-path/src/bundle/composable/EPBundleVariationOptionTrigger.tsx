import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { useBundleVariation } from "./BundleContext";
import {
  MOCK_BUNDLE_VARIATIONS,
  MOCK_BUNDLE_VARIATION_OPTIONS,
  MockBundleVariation,
  MockBundleVariationOption,
} from "./design-time-data";

type PreviewState = "auto" | "withData" | "selected" | "unselected";

interface EPBundleVariationOptionTriggerProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleVariationOptionTriggerMeta: ComponentMeta<EPBundleVariationOptionTriggerProps> =
  {
    name: "plasmic-commerce-ep-bundle-variation-option-trigger",
    displayName: "EP Bundle Variation Option Trigger",
    description:
      "Interactive trigger for selecting a variation value (e.g., a specific color). Exposes data-selected for CSS styling. Must be inside an EP Bundle Variation Option List.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-bundle-variation-field",
            props: { field: "name" },
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "selected", "unselected"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPBundleVariationOptionTrigger",
  };

export function EPBundleVariationOptionTrigger(
  props: EPBundleVariationOptionTriggerProps
) {
  const { children, className, previewState = "auto" } = props;

  const currentVariation = useSelector("currentBundleVariation") as
    | MockBundleVariation
    | undefined;
  const currentOption = useSelector("currentBundleVariationOption") as
    | MockBundleVariationOption
    | undefined;
  const variationCtx = useBundleVariation();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "selected" ||
    previewState === "unselected" ||
    previewState === "withData" ||
    (!currentOption && inEditor);

  const variationId = currentVariation?.id ?? MOCK_BUNDLE_VARIATIONS[0].id;
  const label = currentOption?.label ?? MOCK_BUNDLE_VARIATION_OPTIONS[0].label;

  const isSelected = useMock
    ? previewState === "selected" ||
      (previewState !== "unselected" && MOCK_BUNDLE_VARIATION_OPTIONS[0].isSelected)
    : currentOption?.isSelected ?? false;

  const handleClick = () => {
    if (useMock || !variationCtx || !variationId) return;
    variationCtx.selectVariation(variationId, label);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="radio"
      tabIndex={0}
      aria-checked={isSelected}
      aria-label={label || "Select variation"}
      data-selected={isSelected || undefined}
      data-ep-bundle-variation-option-trigger=""
    >
      {children}
    </div>
  );
}

export function registerEPBundleVariationOptionTrigger(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleVariationOptionTriggerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleVariationOptionTrigger,
    customMeta ?? epBundleVariationOptionTriggerMeta
  );
}
