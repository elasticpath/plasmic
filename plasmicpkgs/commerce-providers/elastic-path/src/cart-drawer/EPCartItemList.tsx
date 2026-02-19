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
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import {
  MOCK_CART_LINE_ITEMS,
  MockCartItemData,
} from "../utils/design-time-data";

const log = createLogger("EPCartItemList");

type PreviewState = "auto" | "withItems";

interface EPCartItemListProps {
  children?: React.ReactNode;
  className?: string;
  maxItems?: number;
  previewState?: PreviewState;
}

export const epCartItemListMeta: ComponentMeta<EPCartItemListProps> = {
  name: "plasmic-commerce-ep-cart-item-list",
  displayName: "EP Cart Item List",
  description:
    "Repeats children for each item in the cart. Must be inside an EP Cart Drawer.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "vbox",
          children: [
            {
              type: "component",
              name: "plasmic-commerce-ep-cart-item-field",
              props: { field: "name" },
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-cart-item-field",
              props: { field: "formattedPrice" },
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-cart-item-quantity-control",
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-cart-item-remove-button",
            },
          ],
        },
      ],
    },
    maxItems: {
      type: "number",
      displayName: "Max Items",
      description: "Limit the number of items displayed",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withItems"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCartItemList",
  providesData: true,
};

function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

interface EnrichedCartItem {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  quantity: number;
  path: string;
  sku: string;
  price: number;
  listPrice: number;
  formattedPrice: string;
  formattedListPrice: string;
  lineTotal: number;
  formattedLineTotal: string;
  imageUrl: string;
  imageAlt: string;
  options: { name: string; value: string }[];
  hasDiscount: boolean;
}

function enrichLineItem(
  item: any,
  currencyCode: string
): EnrichedCartItem {
  const price = item.variant?.price ?? item.price ?? 0;
  const listPrice = item.variant?.listPrice ?? item.listPrice ?? price;
  const quantity = item.quantity ?? 1;
  const lineTotal = price * quantity;

  return {
    id: item.id,
    variantId: item.variantId ?? item.variant?.id ?? "",
    productId: item.productId ?? "",
    name: item.name ?? "",
    quantity,
    path: item.path ?? "",
    sku: item.variant?.sku ?? item.sku ?? "",
    price,
    listPrice,
    formattedPrice: formatCurrency(price, currencyCode),
    formattedListPrice: formatCurrency(listPrice, currencyCode),
    lineTotal,
    formattedLineTotal: formatCurrency(lineTotal, currencyCode),
    imageUrl: item.variant?.image?.url ?? "",
    imageAlt: item.variant?.image?.alt ?? item.name ?? "",
    options: item.options ?? [],
    hasDiscount: listPrice > price,
  };
}

export function EPCartItemList(props: EPCartItemListProps) {
  const { children, className, maxItems, previewState = "auto" } = props;

  const cartData = useSelector("cartData") as
    | { lineItems?: any[]; currencyCode?: string }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withItems" ||
    (previewState === "auto" && !cartData?.lineItems?.length && inEditor);

  if (useMock) {
    log.debug("Using mock cart items for design-time preview");
  }

  const items: EnrichedCartItem[] = useMemo(() => {
    if (useMock) {
      return MOCK_CART_LINE_ITEMS as EnrichedCartItem[];
    }
    if (!cartData?.lineItems) return [];
    const currencyCode = cartData.currencyCode ?? "USD";
    return cartData.lineItems.map((item) =>
      enrichLineItem(item, currencyCode)
    );
  }, [useMock, cartData]);

  const displayedItems = maxItems ? items.slice(0, maxItems) : items;

  if (displayedItems.length === 0) return null;

  return (
    <div className={className} role="list" aria-label="Cart items">
      {displayedItems.map((item, i) => (
        <div key={item.id} role="listitem">
          <DataProvider name="currentCartItem" data={item}>
            <DataProvider name="currentCartItemIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        </div>
      ))}
    </div>
  );
}

export function registerEPCartItemList(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCartItemListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartItemList, customMeta ?? epCartItemListMeta);
}
