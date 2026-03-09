import { useMemo } from "react";
import { useCart, type CartData } from "./use-cart";

// ---------------------------------------------------------------------------
// Checkout-display types — flattened and formatted for direct binding in
// Plasmic. These intentionally differ from the raw EP cart shape so that
// Plasmic designers don't need to navigate nested meta.display_price paths.
// ---------------------------------------------------------------------------

export interface CheckoutCartItem {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  /** Unit price in minor units (cents). */
  unitPrice: number;
  /** Line price in minor units (cents). */
  linePrice: number;
  formattedUnitPrice: string;
  formattedLinePrice: string;
  imageUrl: string | null;
}

export interface CheckoutCartData {
  id?: string;
  items: CheckoutCartItem[];
  itemCount: number;
  subtotal: number;
  tax: number;
  /** Always 0 in cart — shipping is calculated during checkout. */
  shipping: number;
  total: number;
  formattedSubtotal: string;
  formattedTax: string;
  formattedShipping: string;
  formattedTotal: string;
  currencyCode: string;
  showImages: boolean;
  hasPromo: boolean;
  promoCode: string | null;
  promoDiscount: number;
  formattedPromoDiscount: string | null;
}

/**
 * Wraps useCart() and normalizes raw EP cart data into checkout display format.
 *
 * Why normalize? The raw EP cart response has deeply nested price structures
 * (meta.display_price.with_tax.unit.amount). Plasmic data bindings work best
 * with flat objects. This hook flattens once via useMemo so child components
 * bind to simple fields like formattedUnitPrice, formattedTotal, etc.
 */
export function useCheckoutCart() {
  const { data, error, isLoading, isEmpty, mutate } = useCart();

  const checkoutData = useMemo<CheckoutCartData | null>(() => {
    if (!data || !data.meta) return null;

    const meta = data.meta.display_price;
    const currency = meta.with_tax.currency || "USD";

    const items: CheckoutCartItem[] = data.items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.meta.display_price.with_tax.unit.amount,
      linePrice: item.meta.display_price.with_tax.value.amount,
      formattedUnitPrice: item.meta.display_price.with_tax.unit.formatted,
      formattedLinePrice: item.meta.display_price.with_tax.value.formatted,
      imageUrl: item.image?.href ?? null,
    }));

    return {
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal: meta.without_tax.amount,
      tax: meta.tax.amount,
      shipping: 0, // Shipping is calculated during checkout, not in cart
      total: meta.with_tax.amount,
      formattedSubtotal: meta.without_tax.formatted,
      formattedTax: meta.tax.formatted,
      formattedShipping: "$0.00",
      formattedTotal: meta.with_tax.formatted,
      currencyCode: currency,
      showImages: true,
      hasPromo: false,
      promoCode: null,
      promoDiscount: 0,
      formattedPromoDiscount: null,
    };
  }, [data]);

  return { data: checkoutData, error, isLoading, isEmpty, mutate };
}
