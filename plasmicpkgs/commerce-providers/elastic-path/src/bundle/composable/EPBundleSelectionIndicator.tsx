import {
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { useBundleOption } from "./BundleContext";
import { MOCK_BUNDLE_COMPONENTS } from "./design-time-data";

type PreviewState = "auto" | "selected" | "unselected";

interface EPBundleSelectionIndicatorProps {
  className?: string;
  previewState?: PreviewState;
}

export const epBundleSelectionIndicatorMeta: ComponentMeta<EPBundleSelectionIndicatorProps> =
  {
    name: "plasmic-commerce-ep-bundle-selection-indicator",
    displayName: "EP Bundle Selection Indicator",
    description:
      "Visual selection indicator for bundle options. Bridges BundleOptionContext.isSelected to a data-selected attribute for CSS styling. Must be inside an EP Bundle Option Trigger.",
    props: {
      previewState: {
        type: "choice",
        options: ["auto", "selected", "unselected"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPBundleSelectionIndicator",
    parentComponentName: "plasmic-commerce-ep-bundle-option-trigger",
  };

export function EPBundleSelectionIndicator(
  props: EPBundleSelectionIndicatorProps
) {
  const { className, previewState = "auto" } = props;

  const optionCtx = useBundleOption();
  const inEditor = !!usePlasmicCanvasContext();

  const isSelected =
    previewState === "selected"
      ? true
      : previewState === "unselected"
        ? false
        : optionCtx
          ? optionCtx.isSelected
          : inEditor
            ? MOCK_BUNDLE_COMPONENTS[0].options[0].isSelected
            : false;

  return (
    <div
      className={className}
      data-selected={isSelected || undefined}
      data-ep-bundle-selection-indicator=""
      aria-hidden="true"
    />
  );
}

export function registerEPBundleSelectionIndicator(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleSelectionIndicatorProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleSelectionIndicator,
    customMeta ?? epBundleSelectionIndicatorMeta
  );
}
