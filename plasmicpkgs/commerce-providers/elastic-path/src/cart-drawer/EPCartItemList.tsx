import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { DEFAULT_CURRENCY_CODE, DEFAULT_LOW_STOCK_THRESHOLD } from "../const";
import { Registerable } from "../registerable";
import { formatCurrency } from "../utils/formatCurrency";
import { createLogger } from "../utils/logger";
import { useLocations } from "../inventory/use-locations";
import { useStock } from "../inventory/use-stock";
import {
  MOCK_CART_LINE_ITEMS,
  MockCartItemData,
} from "../utils/design-time-data";
import { getLocationSlug } from "../utils/getLocationSlug";

const log = createLogger("EPCartItemList");

type PreviewState = "auto" | "withItems";

interface EPCartItemListProps {
  children?: React.ReactNode;
  className?: string;
  maxItems?: number;
  previewState?: PreviewState;
}

export const epCartItemListMeta: CodeComponentMeta<EPCartItemListProps> = {
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
  locationSlug: string;
  locationName: string;
  stockAvailable: number | null;
  stockStatus: string;
}

function enrichLineItem(
  item: any,
  currencyCode: string,
  locationMap: Record<string, string>,
  stockMap: Record<string, Record<string, number>>
): EnrichedCartItem {
  const price = item.variant?.price ?? item.price ?? 0;
  const listPrice = item.variant?.listPrice ?? item.listPrice ?? price;
  const quantity = item.quantity ?? 1;
  const lineTotal = price * quantity;

  const locationSlug = item.locationSlug ?? "";
  const locationName = locationSlug ? (locationMap[locationSlug] ?? locationSlug) : "";

  // Look up stock for this product at its location
  let stockAvailable: number | null = null;
  let stockStatus = "";
  if (locationSlug) {
    const productId = item.variantId ?? item.productId ?? "";
    const productStockByLocation = stockMap[productId];
    if (productStockByLocation && locationSlug in productStockByLocation) {
      stockAvailable = productStockByLocation[locationSlug];
      if (stockAvailable <= 0) {
        stockStatus = "out-of-stock";
      } else if (stockAvailable <= DEFAULT_LOW_STOCK_THRESHOLD) {
        stockStatus = "low";
      } else {
        stockStatus = "in-stock";
      }
    }
  }

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
    locationSlug,
    locationName,
    stockAvailable,
    stockStatus,
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

  // Collect unique location slugs and product IDs from cart items that have locations
  const { locationSlugs, productIds } = useMemo(() => {
    if (useMock || !cartData?.lineItems) return { locationSlugs: [] as string[], productIds: [] as string[] };
    const slugs = new Set<string>();
    const ids = new Set<string>();
    for (const item of cartData.lineItems) {
      const slug = item.locationSlug;
      if (slug) {
        slugs.add(slug);
        const productId = item.variantId ?? item.productId;
        if (productId) ids.add(productId);
      }
    }
    return { locationSlugs: Array.from(slugs), productIds: Array.from(ids) };
  }, [useMock, cartData]);

  const hasLocations = locationSlugs.length > 0;

  // Fetch all locations (only when cart items have locations)
  const { locations } = useLocations({ enabled: hasLocations && !inEditor });

  // Build slug → name map
  const locationMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const loc of locations) {
      const slug = loc.attributes?.slug ?? loc.id;
      const name = loc.attributes?.name ?? slug ?? "";
      if (slug) map[slug] = name;
    }
    return map;
  }, [locations]);

  // Fetch stock for products that have locations
  const { productStock } = useStock({
    productIds,
    locationIds: locationSlugs,
    enabled: hasLocations && !inEditor,
  });

  // Build productId → { locationSlug → available } map
  const stockMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const [productId, stock] of Object.entries(productStock)) {
      map[productId] = {};
      for (const ls of (stock as any).locations) {
        const slug = getLocationSlug(ls.location);
        if (slug) {
          map[productId][slug] = Number(ls.stock.available ?? 0);
        }
      }
    }
    return map;
  }, [productStock]);

  const items: EnrichedCartItem[] = useMemo(() => {
    if (useMock) {
      return MOCK_CART_LINE_ITEMS as EnrichedCartItem[];
    }
    if (!cartData?.lineItems) return [];
    const currencyCode = cartData.currencyCode ?? DEFAULT_CURRENCY_CODE;
    return cartData.lineItems.map((item) =>
      enrichLineItem(item, currencyCode, locationMap, stockMap)
    );
  }, [useMock, cartData, locationMap, stockMap]);

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
  customMeta?: CodeComponentMeta<EPCartItemListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCartItemList, customMeta ?? epCartItemListMeta);
}
