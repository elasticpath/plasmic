import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import type { Cart, CartItem } from "../../types/cart";
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

function isCartField(field: FieldName): field is CartFieldName {
  return CART_FIELDS.has(field);
}

type PreviewState = "auto" | "withData";

interface EPCheckoutCartFieldProps {
  field: FieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epCheckoutCartFieldMeta: CodeComponentMeta<EPCheckoutCartFieldProps> = {
  name: "plasmic-commerce-ep-checkout-cart-field",
  displayName: "EP Checkout Cart Field",
  description:
    "Displays a checkout cart field. Reads from the cart published by EP Checkout Cart Summary, or from the current checkout item, depending on the field.",
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

/**
 * Resolves a saved field choice against the checkout cart.
 *
 * The choice *values* are the binding contract, so they stay stable while the
 * paths behind them move with Elastic Path's shape.
 */
function checkoutCartFieldValue(
  cart: Cart,
  field: CartFieldName
): string | number | undefined {
  const price = cart.meta?.display_price;
  switch (field) {
    case "formattedSubtotal":
      return price?.without_tax?.formatted;
    case "formattedTotal":
      return price?.with_tax?.formatted ?? price?.without_tax?.formatted;
    case "formattedShipping":
      return price?.shipping?.formatted;
    case "formattedTax":
      return price?.tax?.formatted;
    case "itemCount":
      return cart.itemCount;
  }
}

/** The same contract for the fields addressed against a single checkout line. */
function checkoutItemFieldValue(
  item: CartItem,
  field: ItemFieldName
): string | number | undefined {
  switch (field) {
    case "formattedPrice":
      return item.meta?.display_price?.without_tax?.unit?.formatted;
    case "imageUrl":
      return item.image?.href;
    default:
      return item[field];
  }
}

export function EPCheckoutCartField(props: EPCheckoutCartFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const cart = useSelector("cart") as Cart | undefined;
  const currentItem = useSelector("currentCheckoutItem") as
    | CartItem
    | undefined;

  if (isCartField(field)) {
    const useMock = previewState === "withData" || (!cart && inEditor);

    const effectiveData = useMock ? MOCK_CHECKOUT_CART_DATA : cart;
    if (!effectiveData) return null;

    const value = checkoutCartFieldValue(effectiveData, field);
    return <span className={className}>{value ?? ""}</span>;
  }

  // Item field
  const useMock = previewState === "withData" || (!currentItem && inEditor);

  const effectiveItem = useMock ? MOCK_CHECKOUT_CART_ITEMS[0] : currentItem;
  if (!effectiveItem) return null;

  const value = checkoutItemFieldValue(effectiveItem, field);

  if (field === "imageUrl") {
    return (
      <img
        className={className}
        src={value as string | undefined}
        alt={effectiveItem.name ?? ""}
        style={{ maxWidth: "100%", height: "auto" }}
      />
    );
  }

  return <span className={className}>{value ?? ""}</span>;
}

export function registerEPCheckoutCartField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutCartFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutCartField,
    customMeta ?? epCheckoutCartFieldMeta
  );
}
