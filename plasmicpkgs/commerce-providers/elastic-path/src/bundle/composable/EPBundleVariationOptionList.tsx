import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../../registerable";
import { useBundleVariation } from "./BundleContext";
import {
  MOCK_BUNDLE_VARIATION_OPTIONS,
  MockBundleVariation,
  MockBundleVariationOption,
} from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPBundleVariationOptionListProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleVariationOptionListMeta: ComponentMeta<EPBundleVariationOptionListProps> =
  {
    name: "plasmic-commerce-ep-bundle-variation-option-list",
    displayName: "EP Bundle Variation Option List",
    description:
      "Iterates over values for a single variation axis (e.g., Color: Red, Blue). Provides currentBundleVariationOption and currentBundleVariationOptionIndex to children. Must be inside an EP Bundle Variation Picker.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-bundle-variation-option-trigger",
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPBundleVariationOptionList",
    parentComponentName: "plasmic-commerce-ep-bundle-variation-picker",
    providesData: true,
  };

export function EPBundleVariationOptionList(
  props: EPBundleVariationOptionListProps
) {
  const { children, className, previewState = "auto" } = props;

  const currentVariation = useSelector("currentBundleVariation") as
    | MockBundleVariation
    | undefined;
  const variationCtx = useBundleVariation();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!currentVariation && inEditor);

  // Build option list with isSelected from context
  const options: MockBundleVariationOption[] = useMemo(() => {
    if (useMock) return MOCK_BUNDLE_VARIATION_OPTIONS;
    if (!currentVariation?.values) return [];

    const selectedValues = variationCtx?.selectedValues ?? {};
    const selectedForThisAxis = selectedValues[currentVariation.id];

    return currentVariation.values.map((v) => ({
      label: v.label,
      isSelected: selectedForThisAxis === v.label,
    }));
  }, [useMock, currentVariation, variationCtx?.selectedValues]);

  if (options.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Variation values">
      {options.map((option, i) => (
        <div key={option.label} role="listitem">
          <DataProvider name="currentBundleVariationOption" data={option}>
            <DataProvider name="currentBundleVariationOptionIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPBundleVariationOptionList(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleVariationOptionListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleVariationOptionList,
    customMeta ?? epBundleVariationOptionListMeta
  );
}
