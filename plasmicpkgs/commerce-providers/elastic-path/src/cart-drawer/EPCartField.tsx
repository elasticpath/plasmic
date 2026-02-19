import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_CART_DATA } from "../utils/design-time-data";

type CartFieldName =
  | "itemCount"
  | "formattedSubtotal"
  | "formattedTotal"
  | "currencyCode"
  | "isEmpty";

type PreviewState = "auto" | "withData";

interface EPCartFieldProps {
  field: CartFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epCartFieldMeta: ComponentMeta<EPCartFieldProps> = {
  name: "plasmic-commerce-ep-cart-field",
  displayName: "EP Cart Field",
  description:
    "Displays a cart summary field (item count, subtotal, total, etc.). Must be inside an EP Cart Drawer.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Item Count", value: "itemCount" },
        { label: "Formatted Subtotal", value: "formattedSubtotal" },
        { label: "Formatted Total", value: "formattedTotal" },
        { label: "Currency Code", value: "currencyCode" },
        { label: "Is Empty", value: "isEmpty" },
      ],
      defaultValue: "formattedTotal",
      displayName: "Field",
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
  importName: "EPCartField",
};

export function EPCartField(props: EPCartFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const cartData = useSelector("cartData") as Record<string, any> | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!cartData && inEditor);

  const effectiveData = useMock ? MOCK_CART_DATA : cartData;

  if (!effectiveData) return null;

  const value = effectiveData[field];
  const display = typeof value === "boolean" ? String(value) : value;

  return <span className={className}>{display ?? ""}</span>;
}

export function registerEPCartField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCartFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartField, customMeta ?? epCartFieldMeta);
}
