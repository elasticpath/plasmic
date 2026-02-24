import {
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useMemo } from "react";
import { Registerable } from "../../registerable";
import {
  BundleOptionContext,
  BundleOptionContextValue,
  useBundleFormContext,
} from "./BundleContext";
import { MOCK_BUNDLE_COMPONENTS } from "./design-time-data";

type PreviewState = "auto" | "withData" | "selected" | "unselected";

interface EPBundleOptionTriggerProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleOptionTriggerMeta: ComponentMeta<EPBundleOptionTriggerProps> =
  {
    name: "plasmic-commerce-ep-bundle-option-trigger",
    displayName: "EP Bundle Option Trigger",
    description:
      "Interactive selection trigger for a bundle option. Acts as a checkbox (multi-select) or radio button (single-select) based on the component's min/max. Exposes data-selected for CSS styling. Must be inside an EP Bundle Option List.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-bundle-option-field",
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
    importName: "EPBundleOptionTrigger",
    providesData: true,
  };

export function EPBundleOptionTrigger(props: EPBundleOptionTriggerProps) {
  const { children, className, previewState = "auto" } = props;

  const currentOption = useSelector("currentBundleOption") as
    | {
        id?: string;
        isSelected?: boolean;
        quantity?: number;
        minQty?: number | null;
        maxQty?: number | null;
      }
    | undefined;
  const currentComponent = useSelector("currentBundleComponent") as
    | { key?: string; min?: number; max?: number }
    | undefined;
  const formCtx = useBundleFormContext();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "selected" ||
    previewState === "unselected" ||
    previewState === "withData" ||
    (!currentOption && inEditor);

  // Determine single-select vs multi-select from component min/max
  const isSingleSelect =
    (currentComponent?.min === 1 && currentComponent?.max === 1) ||
    (useMock && MOCK_BUNDLE_COMPONENTS[0].min === 1 && MOCK_BUNDLE_COMPONENTS[0].max === 1);

  const optionId = currentOption?.id ?? MOCK_BUNDLE_COMPONENTS[0].options[0].id;
  const componentKey =
    currentComponent?.key ?? MOCK_BUNDLE_COMPONENTS[0].key;

  const isSelected = useMock
    ? previewState === "selected" ||
      (previewState !== "unselected" && MOCK_BUNDLE_COMPONENTS[0].options[0].isSelected)
    : currentOption?.isSelected ?? false;

  const quantity = currentOption?.quantity ?? (isSelected ? 1 : 0);

  const toggleOption = useCallback(() => {
    if (!formCtx || !currentComponent?.key || !currentOption?.id) return;
    const newQuantity = isSelected ? 0 : 1;
    formCtx.handleComponentSelection(
      currentComponent.key,
      currentOption.id,
      newQuantity
    );
  }, [formCtx, currentComponent?.key, currentOption?.id, isSelected]);

  const setQuantity = useCallback(
    (n: number) => {
      if (!formCtx || !currentComponent?.key || !currentOption?.id) return;
      formCtx.handleComponentSelection(
        currentComponent.key,
        currentOption.id,
        n
      );
    },
    [formCtx, currentComponent?.key, currentOption?.id]
  );

  const contextValue: BundleOptionContextValue = useMemo(
    () => ({
      componentKey,
      optionId,
      isSelected,
      quantity,
      toggleOption,
      setQuantity,
    }),
    [componentKey, optionId, isSelected, quantity, toggleOption, setQuantity]
  );

  const role = isSingleSelect ? "radio" : "checkbox";

  const handleClick = () => {
    if (useMock) return;
    toggleOption();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <BundleOptionContext.Provider value={contextValue}>
      <div
        className={className}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role={role}
        tabIndex={0}
        aria-checked={isSelected}
        aria-label={currentOption?.id ? undefined : "Select option"}
        data-selected={isSelected || undefined}
        data-ep-bundle-option-trigger=""
      >
        {children}
      </div>
    </BundleOptionContext.Provider>
  );
}

export function registerEPBundleOptionTrigger(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleOptionTriggerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleOptionTrigger,
    customMeta ?? epBundleOptionTriggerMeta
  );
}
