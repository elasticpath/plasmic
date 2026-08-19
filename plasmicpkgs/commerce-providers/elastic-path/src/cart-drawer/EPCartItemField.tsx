import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_CART_LINE_ITEMS } from "../utils/design-time-data";
import { CartItemOption, formatOptionValues } from "../utils/option-values";

type CartItemFieldName =
  | "name"
  | "quantity"
  | "sku"
  | "formattedPrice"
  | "formattedListPrice"
  | "formattedLineTotal"
  | "options"
  | "optionValues"
  | "productId"
  | "locationName"
  | "locationSlug"
  | "stockAvailable"
  | "stockStatus";

type PreviewState = "auto" | "withData";

interface EPCartItemFieldProps {
  field: CartItemFieldName;
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epCartItemFieldMeta: CodeComponentMeta<EPCartItemFieldProps> = {
  name: "plasmic-commerce-ep-cart-item-field",
  displayName: "EP Cart Item Field",
  description:
    "Displays a field from the current cart item (name, price, quantity, options, …). Renders the value as text by default; drop children to fully compose the rendering against the resolved value ($ctx.resolvedValue / options / hasValue). Must be inside an EP Cart Item List.",
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
        { label: "Options (Name: Value)", value: "options" },
        { label: "Option Values (Value / Value)", value: "optionValues" },
        { label: "Location Name", value: "locationName" },
        { label: "Location Slug", value: "locationSlug" },
        { label: "Stock Available", value: "stockAvailable" },
        { label: "Stock Status", value: "stockStatus" },
        { label: "Product ID", value: "productId" },
      ],
      defaultValue: "name",
      displayName: "Field",
    },
    children: {
      type: "slot",
      displayName: "Children (custom render)",
      description:
        "Optional. When filled, you compose the rendering; descendants read $ctx.resolvedValue (string), $ctx.options ({name,value}[]), and $ctx.hasValue (boolean). Leave empty for the sensible default text.",
      hidePlaceholder: true,
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
  providesData: true,
};

/**
 * Resolves a saved field choice against an Elastic Path cart line.
 *
 * The choice *values* are the binding contract, so they stay stable while the
 * paths behind them move with Elastic Path's shape.
 */
function cartItemFieldValue(
  item: Record<string, any>,
  field: CartItemFieldName
): unknown {
  const price = item.meta?.display_price;
  switch (field) {
    case "formattedPrice":
      return price?.without_tax?.unit?.formatted;
    case "formattedListPrice":
      return (
        price?.without_discount?.unit?.formatted ??
        price?.without_tax?.unit?.formatted
      );
    case "formattedLineTotal":
      return price?.without_tax?.value?.formatted;
    case "productId":
      return item.product_id;
    case "locationSlug":
      return item.location;
    default:
      return item[field];
  }
}

/** Resolve the display string + structured options + presence for a field. */
function resolveCartItemField(
  item: Record<string, any>,
  field: CartItemFieldName
): { resolvedValue: string; options: CartItemOption[]; hasValue: boolean } {
  const options = (item.options as CartItemOption[] | undefined) ?? [];

  if (field === "options") {
    const resolvedValue = options
      .map((o) => `${o.name}: ${o.value}`)
      .join(", ");
    return { resolvedValue, options, hasValue: options.length > 0 };
  }

  if (field === "optionValues") {
    const resolvedValue = formatOptionValues(options);
    return { resolvedValue, options, hasValue: resolvedValue !== "" };
  }

  const raw = cartItemFieldValue(item, field);
  const resolvedValue = raw == null ? "" : String(raw);
  return { resolvedValue, options, hasValue: resolvedValue !== "" };
}

export function EPCartItemField(props: EPCartItemFieldProps) {
  const { field, children, className, previewState = "auto" } = props;

  const currentItem = useSelector("currentCartItem") as
    | Record<string, any>
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock = previewState === "withData" || (!currentItem && inEditor);
  const effectiveItem = useMock ? MOCK_CART_LINE_ITEMS[0] : currentItem;

  if (!effectiveItem) return null;

  const { resolvedValue, options, hasValue } = resolveCartItemField(
    effectiveItem,
    field
  );

  // Slot filled → designer fully composes the rendering against the resolved
  // value; the presence flag lets them gate surrounding markup themselves.
  const hasChildren = React.Children.count(children) > 0;
  if (hasChildren) {
    return (
      <DataProvider name="resolvedValue" data={resolvedValue}>
        <DataProvider name="options" data={options}>
          <DataProvider name="hasValue" data={hasValue}>
            <div className={className} data-ep-cart-item-field="">
              {children}
            </div>
          </DataProvider>
        </DataProvider>
      </DataProvider>
    );
  }

  // Default: render the resolved value as text (empty options → empty string,
  // never "undefined" or stray separators).
  return (
    <span className={className} data-ep-cart-item-field="">
      {resolvedValue}
    </span>
  );
}

export function registerEPCartItemField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartItemFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartItemField, customMeta ?? epCartItemFieldMeta);
}
