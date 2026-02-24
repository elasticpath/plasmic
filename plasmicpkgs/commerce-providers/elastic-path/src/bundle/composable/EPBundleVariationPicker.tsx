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
import {
  useBundleFormContext,
  useBundleOption,
  BundleVariationContext,
  BundleVariationContextValue,
} from "./BundleContext";
import { useVariationSelection } from "../hooks/useVariationSelection";
import { ParentProductInfo } from "../use-parent-products";
import {
  MOCK_BUNDLE_VARIATIONS,
  MockBundleVariation,
} from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPBundleVariationPickerProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleVariationPickerMeta: ComponentMeta<EPBundleVariationPickerProps> =
  {
    name: "plasmic-commerce-ep-bundle-variation-picker",
    displayName: "EP Bundle Variation Picker",
    description:
      "Iterates over variation axes for a parent product bundle option. Detects if the current option is a parent product and renders variation selectors. Must be inside an EP Bundle Option Trigger.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              {
                type: "component",
                name: "plasmic-commerce-ep-bundle-variation-field",
                props: { field: "name" },
              },
              {
                type: "component",
                name: "plasmic-commerce-ep-bundle-variation-option-list",
              },
            ],
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
    importName: "EPBundleVariationPicker",
    parentComponentName: "plasmic-commerce-ep-bundle-option-trigger",
    providesData: true,
  };

export function EPBundleVariationPicker(
  props: EPBundleVariationPickerProps
) {
  const { children, className, previewState = "auto" } = props;

  const optionCtx = useBundleOption();
  const formCtx = useBundleFormContext();
  const currentOption = useSelector("currentBundleOption") as
    | { id?: string; isParentProduct?: boolean }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" ||
    (!currentOption && inEditor);

  const optionId = optionCtx?.optionId ?? currentOption?.id ?? "";
  const componentKey = optionCtx?.componentKey ?? "";
  const isParentProduct = currentOption?.isParentProduct ?? false;

  // Get parent product info from form context
  const parentInfo: ParentProductInfo | undefined = formCtx?.parentProducts[optionId];

  // Use variation selection hook for real data
  const {
    variationSelections,
    handleVariationChange,
  } = useVariationSelection({
    parentInfo: parentInfo ?? { id: optionId, isParent: false, loading: false },
    onSelectionChange: formCtx?.handleComponentSelection ?? (() => {}),
    componentKey,
    optionId,
  });

  // Build variation list
  const variations: MockBundleVariation[] = useMemo(() => {
    if (useMock) return MOCK_BUNDLE_VARIATIONS;
    if (!isParentProduct || !parentInfo?.variations) return [];

    return parentInfo.variations.map((v) => ({
      id: v.id,
      name: v.name,
      values: v.options?.map((opt) => ({ id: opt.id, label: opt.name })) ?? [],
    }));
  }, [useMock, isParentProduct, parentInfo?.variations]);

  // Build variation context value
  const variationContextValue: BundleVariationContextValue = useMemo(
    () => ({
      selectedValues: useMock
        ? { "var-color": "opt-color-1", "var-capacity": "opt-cap-1" }
        : variationSelections,
      selectVariation: useMock
        ? () => {}
        : handleVariationChange,
    }),
    [useMock, variationSelections, handleVariationChange]
  );

  // Don't render if not a parent product (unless in mock mode)
  if (!useMock && !isParentProduct) return null;
  if (variations.length === 0) return null;

  return (
    <BundleVariationContext.Provider value={variationContextValue}>
      <div className={className} role="list" aria-label="Variation options">
        {variations.map((variation, i) => (
          <div key={variation.id} role="listitem">
            <DataProvider name="currentBundleVariation" data={variation}>
              <DataProvider name="currentBundleVariationIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          </div>
        ))}
      </div>
    </BundleVariationContext.Provider>
  );
}

export function registerEPBundleVariationPicker(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleVariationPickerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleVariationPicker,
    customMeta ?? epBundleVariationPickerMeta
  );
}
