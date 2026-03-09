import useSWR from "swr";
import { useShopperFetch } from "./useShopperFetch";
import { useShopperContext } from "./useShopperContext";

// ---------------------------------------------------------------------------
// Types — defined inline, NOT imported from EP SDK. Decoupling from the SDK
// means consumers don't need @epcc-sdk/sdks-shopper installed, and type
// changes in the SDK won't silently break cart display.
// ---------------------------------------------------------------------------

export interface CartItem {
  id: string;
  type: string;
  product_id: string;
  name: string;
  description: string;
  sku: string;
  slug: string;
  quantity: number;
  image?: { href: string; mime_type?: string };
  meta: {
    display_price: {
      with_tax: {
        unit: { amount: number; formatted: string; currency: string };
        value: { amount: number; formatted: string; currency: string };
      };
      without_tax: {
        unit: { amount: number; formatted: string; currency: string };
        value: { amount: number; formatted: string; currency: string };
      };
    };
  };
}

export interface CartMeta {
  display_price: {
    with_tax: { amount: number; formatted: string; currency: string };
    without_tax: { amount: number; formatted: string; currency: string };
    tax: { amount: number; formatted: string; currency: string };
    discount?: { amount: number; formatted: string; currency: string };
  };
}

export interface CartData {
  items: CartItem[];
  meta: CartMeta | null;
}

export interface UseCartReturn {
  data: CartData | null;
  error: Error | null;
  isLoading: boolean;
  isEmpty: boolean;
  mutate: () => Promise<CartData | undefined>;
}

/**
 * Fetch cart data from the consumer's GET /api/cart server route.
 *
 * Why a server route instead of direct EP SDK calls?
 * - Cart operations require a client_secret — that credential must never
 *   reach the browser. The server route holds the secret and the browser
 *   only sends an httpOnly cookie (ep_cart) for identity.
 * - useShopperFetch auto-attaches the X-Shopper-Context header when
 *   overrides are present (Studio preview or checkout URL).
 *
 * SWR cache key includes cartId when present so changing the cart in
 * Plasmic Studio triggers an automatic refetch.
 */
export function useCart(): UseCartReturn {
  const shopperFetch = useShopperFetch();
  const { cartId } = useShopperContext();

  // Include cartId in cache key so SWR refetches when designer changes it in Studio
  const cacheKey = cartId ? ["cart", cartId] : "cart";

  const { data, error, mutate } = useSWR<CartData>(
    cacheKey,
    () => shopperFetch<CartData>("/api/cart"),
    { revalidateOnFocus: false }
  );

  return {
    data: data ?? null,
    error: error ?? null,
    isLoading: !data && !error,
    isEmpty: !data || data.items.length === 0,
    mutate: mutate as () => Promise<CartData | undefined>,
  };
}
