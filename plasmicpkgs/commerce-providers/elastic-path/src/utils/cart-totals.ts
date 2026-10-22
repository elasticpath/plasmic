import type { Cart, CartItem, CartMeta } from "../types/cart";

/** The cart's totals as its lines add up: without the checkout's shipping line. */
export function shopperCartTotals(cart: Cart): CartMeta["display_price"] {
  return (cart.withoutShipping?.meta ?? cart.meta)?.display_price;
}

/** The cart's promotions, less what they took off the checkout's shipping line. */
export function shopperCartPromotions(cart: Cart): CartItem[] {
  return cart.withoutShipping?.promotions ?? cart.promotions;
}
