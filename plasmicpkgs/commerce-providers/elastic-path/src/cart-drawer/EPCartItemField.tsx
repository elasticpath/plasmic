import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_CART_LINE_ITEMS } from "../utils/design-time-data";

type CartItemFieldName =
  | "name"
  | "quantity"
  | "sku"
  | "formattedPrice"
  | "formattedListPrice"
  | "formattedLineTotal"
  | "options"
  | "productId"
  | "variantId"
  | "locationName"
  | "locationSlug"
  | "stockAvailable"
  | "stockStatus";

type PreviewState = "auto" | "withData";

interface EPCartItemFieldProps {
  field: CartItemFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epCartItemFieldMeta: ComponentMeta<EPCartItemFieldProps> = {
  name: "plasmic-commerce-ep-cart-item-field",
  displayName: "EP Cart Item Field",
  description:
    "Displays a field from the current cart item (name, price, quantity, etc.). Must be inside an EP Cart Item List.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Name", value: "name" },
        { label: "Quantity", value: "quantity" },
        { label: "SKU", value: "sku" },
        { label: "Formatted Price", value: "formattedPrice" },
        { label: "Formatted List Price", value: "formattedListPrice" },
        { label: "Formatted Line Total", value: "formattedLineTotal" },
        { label: "Options", value: "options" },
        { label: "Location Name", value: "locationName" },
        { label: "Location Slug", value: "locationSlug" },
        { label: "Stock Available", value: "stockAvailable" },
        { label: "Stock Status", value: "stockStatus" },
        { label: "Product ID", value: "productId" },
        { label: "Variant ID", value: "variantId" },
      ],
      defaultValue: "name",
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
  importName: "EPCartItemField",
};

export function EPCartItemField(props: EPCartItemFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const currentItem = useSelector("currentCartItem") as
    | Record<string, any>
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!currentItem && inEditor);

  const effectiveItem = useMock ? MOCK_CART_LINE_ITEMS[0] : currentItem;

  if (!effectiveItem) return null;

  if (field === "options") {
    const options = effectiveItem.options as
      | { name: string; value: string }[]
      | undefined;
    const display = options?.map((o) => `${o.name}: ${o.value}`).join(", ");
    return <span className={className}>{display ?? ""}</span>;
  }

  const value = effectiveItem[field];
  return <span className={className}>{value ?? ""}</span>;
}

export function registerEPCartItemField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCartItemFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartItemField, customMeta ?? epCartItemFieldMeta);
}
