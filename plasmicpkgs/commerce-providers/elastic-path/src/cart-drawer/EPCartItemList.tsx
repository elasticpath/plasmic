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
import { DEFAULT_LOW_STOCK_THRESHOLD } from "../const";
import { Registerable } from "../registerable";
import type { Cart, CartItem, SelectedOption } from "../types/cart";
import { createLogger } from "../utils/logger";
import { useLocations } from "../inventory/use-locations";
import { useStock } from "../inventory/use-stock";
import { MOCK_CART_LINE_ITEMS } from "../utils/design-time-data";
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

type EnrichedCartItem = CartItem & {
  options: SelectedOption[];
  locationName: string;
  stockAvailable: number | null;
  stockStatus: string;
};

/**
 * A cart line plus what only the storefront can work out: the stock location's
 * display name and its availability. Everything else — name, sku, quantity,
 * image, and every price with its formatted string — is already on the line.
 */
function enrichLineItem(
  item: CartItem,
  locationMap: Record<string, string>,
  stockMap: Record<string, Record<string, number>>
): EnrichedCartItem {
  const locationSlug = item.location ?? "";
  const locationName = locationSlug
    ? locationMap[locationSlug] ?? locationSlug
    : "";

  let stockAvailable: number | null = null;
  let stockStatus = "";
  if (locationSlug) {
    const byLocation = stockMap[item.product_id ?? ""];
    if (byLocation && locationSlug in byLocation) {
      stockAvailable = byLocation[locationSlug];
      stockStatus =
        stockAvailable <= 0
          ? "out-of-stock"
          : stockAvailable <= DEFAULT_LOW_STOCK_THRESHOLD
          ? "low"
          : "in-stock";
    }
  }

  return {
    ...item,
    options: selectedOptionsOf(item),
    locationName,
    stockAvailable,
    stockStatus,
  };
}

/** The variation options a shopper chose, persisted in EP's `custom_inputs`. */
function selectedOptionsOf(item: CartItem): SelectedOption[] {
  const raw = item.custom_inputs?._selectedOptions;
  return Array.isArray(raw)
    ? raw.filter(
        (o: any) =>
          o && typeof o.name === "string" && typeof o.value === "string"
      )
    : [];
}

export function EPCartItemList(props: EPCartItemListProps) {
  const { children, className, maxItems, previewState = "auto" } = props;

  const cart = useSelector("cart") as Cart | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withItems" ||
    (previewState === "auto" && !cart?.items?.length && inEditor);

  if (useMock) {
    log.debug("Using mock cart items for design-time preview");
  }

  // Collect unique location slugs and product IDs from cart items that have locations
  const { locationSlugs, productIds } = useMemo(() => {
    if (useMock || !cart?.items) {
      return { locationSlugs: [] as string[], productIds: [] as string[] };
    }
    const slugs = new Set<string>();
    const ids = new Set<string>();
    for (const item of cart.items) {
      const slug = item.location;
      if (slug) {
        slugs.add(slug);
        if (item.product_id) ids.add(item.product_id);
      }
    }
    return { locationSlugs: Array.from(slugs), productIds: Array.from(ids) };
  }, [useMock, cart]);

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
      return MOCK_CART_LINE_ITEMS as unknown as EnrichedCartItem[];
    }
    if (!cart?.items) return [];
    return cart.items.map((item) => enrichLineItem(item, locationMap, stockMap));
  }, [useMock, cart, locationMap, stockMap]);

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
