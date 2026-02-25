import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../../registerable";
import { useBundleOption } from "./BundleContext";
import { MOCK_BUNDLE_COMPONENTS } from "./design-time-data";

type PreviewState = "auto" | "withData" | "minReached" | "maxReached";

interface EPBundleOptionQuantityControlProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleOptionQuantityControlMeta: ComponentMeta<EPBundleOptionQuantityControlProps> =
  {
    name: "plasmic-commerce-ep-bundle-option-quantity-control",
    displayName: "EP Bundle Option Quantity Control",
    description:
      "Controls for changing the quantity of a bundle option. Wraps increment/decrement buttons and a quantity display. Must be inside an EP Bundle Option Trigger.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-bundle-option-quantity-button",
            props: { action: "decrement" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-bundle-option-field",
            props: { field: "quantity" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-bundle-option-quantity-button",
            props: { action: "increment" },
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "minReached", "maxReached"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPBundleOptionQuantityControl",
    parentComponentName: "plasmic-commerce-ep-bundle-option-trigger",
    providesData: true,
  };

export function EPBundleOptionQuantityControl(
  props: EPBundleOptionQuantityControlProps
) {
  const { children, className, previewState = "auto" } = props;

  const currentOption = useSelector("currentBundleOption") as
    | {
        quantity?: number;
        minQty?: number | null;
        maxQty?: number | null;
      }
    | undefined;
  const optionCtx = useBundleOption();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState !== "auto" || (!currentOption && inEditor);

  const mockOption = MOCK_BUNDLE_COMPONENTS[1].options[0]; // memory option with minQty/maxQty
  const min = useMock ? (mockOption.minQty ?? 0) : (currentOption?.minQty ?? 0);
  const max = useMock ? (mockOption.maxQty ?? 99) : (currentOption?.maxQty ?? 99);

  const quantity = useMock
    ? previewState === "minReached"
      ? min
      : previewState === "maxReached"
        ? max
        : mockOption.quantity
    : optionCtx?.quantity ?? currentOption?.quantity ?? 0;

  const canDecrement = quantity > min;
  const canIncrement = quantity < max;

  const increment = () => {
    if (!canIncrement || !optionCtx || useMock) return;
    optionCtx.setQuantity(quantity + 1);
  };

  const decrement = () => {
    if (!canDecrement || !optionCtx || useMock) return;
    optionCtx.setQuantity(quantity - 1);
  };

  const quantityData = useMemo(
    () => ({
      quantity,
      canDecrement,
      canIncrement,
      min,
      max,
    }),
    [quantity, canDecrement, canIncrement, min, max]
  );

  return (
    <DataProvider name="bundleOptionQuantity" data={quantityData}>
      <div
        className={className}
        data-ep-bundle-option-quantity-control=""
      >
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPBundleOptionQuantityControl(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleOptionQuantityControlProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleOptionQuantityControl,
    customMeta ?? epBundleOptionQuantityControlMeta
  );
}
