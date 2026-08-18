import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import type { Cart } from "../types/cart";
import { MOCK_CART_DATA } from "../utils/design-time-data";

type CartFieldName =
  | "itemCount"
  | "formattedSubtotal"
  | "formattedTax"
  | "formattedTotal"
  | "currencyCode"
  | "isEmpty";

type PreviewState = "auto" | "withData";

interface EPCartFieldProps {
  field: CartFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epCartFieldMeta: CodeComponentMeta<EPCartFieldProps> = {
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
        { label: "Formatted Tax", value: "formattedTax" },
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

/**
 * Resolves a saved field choice against the cart.
 *
 * The choice *values* are the binding contract, so they stay stable while the
 * paths behind them move with Elastic Path's shape.
 */
function cartFieldValue(cart: Cart, field: CartFieldName): unknown {
  const price = cart.meta?.display_price;
  switch (field) {
    case "itemCount":
      return cart.itemCount;
    case "formattedSubtotal":
      return price?.without_tax?.formatted;
    case "formattedTax":
      return price?.tax?.formatted;
    case "formattedTotal":
      return price?.with_tax?.formatted ?? price?.without_tax?.formatted;
    case "currencyCode":
      return price?.without_tax?.currency ?? price?.with_tax?.currency;
    case "isEmpty":
      return cart.itemCount === 0;
  }
}

export function EPCartField(props: EPCartFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const cart = useSelector("cart") as Cart | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock = previewState === "withData" || (!cart && inEditor);

  const effectiveData = useMock ? MOCK_CART_DATA : cart;

  if (!effectiveData) return null;

  const value = cartFieldValue(effectiveData, field);
  const display =
    typeof value === "boolean" ? String(value) : (value as React.ReactNode);

  return <span className={className}>{display ?? ""}</span>;
}

export function registerEPCartField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartField, customMeta ?? epCartFieldMeta);
}
