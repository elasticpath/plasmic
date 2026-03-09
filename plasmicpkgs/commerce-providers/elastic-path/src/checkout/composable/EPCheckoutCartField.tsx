import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import {
  MOCK_CHECKOUT_CART_DATA,
  MOCK_CHECKOUT_CART_ITEMS,
} from "../../utils/design-time-data";

type CartFieldName =
  | "formattedSubtotal"
  | "formattedTotal"
  | "formattedShipping"
  | "formattedTax"
  | "itemCount";

type ItemFieldName =
  | "name"
  | "quantity"
  | "formattedPrice"
  | "imageUrl"
  | "sku";

type FieldName = CartFieldName | ItemFieldName;

const CART_FIELDS = new Set<string>([
  "formattedSubtotal",
  "formattedTotal",
  "formattedShipping",
  "formattedTax",
  "itemCount",
]);

type PreviewState = "auto" | "withData";

interface EPCheckoutCartFieldProps {
  field: FieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epCheckoutCartFieldMeta: ComponentMeta<EPCheckoutCartFieldProps> = {
  name: "plasmic-commerce-ep-checkout-cart-field",
  displayName: "EP Checkout Cart Field",
  description:
    "Displays a checkout cart field. Reads from checkoutCartData or currentCheckoutItem depending on the field.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Formatted Subtotal", value: "formattedSubtotal" },
        { label: "Formatted Total", value: "formattedTotal" },
        { label: "Formatted Shipping", value: "formattedShipping" },
        { label: "Formatted Tax", value: "formattedTax" },
        { label: "Item Count", value: "itemCount" },
        { label: "Item Name", value: "name" },
        { label: "Item Quantity", value: "quantity" },
        { label: "Item Formatted Price", value: "formattedPrice" },
        { label: "Item Image URL", value: "imageUrl" },
        { label: "Item SKU", value: "sku" },
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
  importName: "EPCheckoutCartField",
};

export function EPCheckoutCartField(props: EPCheckoutCartFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const cartData = useSelector("checkoutCartData") as
    | Record<string, any>
    | undefined;
  const currentItem = useSelector("currentCheckoutItem") as
    | Record<string, any>
    | undefined;

  const isCartField = CART_FIELDS.has(field);

  if (isCartField) {
    const useMock =
      previewState === "withData" || (!cartData && inEditor);

    const effectiveData = useMock
      ? (MOCK_CHECKOUT_CART_DATA as Record<string, any>)
      : cartData;
    if (!effectiveData) return null;

    const value = effectiveData[field];
    return <span className={className}>{value ?? ""}</span>;
  }

  // Item field
  const useMock =
    previewState === "withData" || (!currentItem && inEditor);

  const effectiveItem = useMock
    ? (MOCK_CHECKOUT_CART_ITEMS[0] as Record<string, any>)
    : currentItem;
  if (!effectiveItem) return null;

  if (field === "imageUrl") {
    return (
      <img
        className={className}
        src={effectiveItem.imageUrl}
        alt={effectiveItem.name ?? ""}
        style={{ maxWidth: "100%", height: "auto" }}
      />
    );
  }

  const value = effectiveItem[field];
  return <span className={className}>{value ?? ""}</span>;
}

export function registerEPCheckoutCartField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCheckoutCartFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutCartField,
    customMeta ?? epCheckoutCartFieldMeta
  );
}
