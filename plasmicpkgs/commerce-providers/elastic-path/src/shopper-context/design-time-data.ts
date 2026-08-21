import type { Cart } from "../types/cart";
import { mockCartItem } from "../utils/design-time-data";

/**
 * Mock cart data for Plasmic Studio design-time preview.
 *
 * Uses Ember & Wick product names so designers see realistic candle/diffuser
 * data while styling checkout components. Prices use minor units (cents) to
 * match the real EP API response shape.
 */
export const MOCK_SERVER_CART_DATA: Cart = {
  id: "mock-cart-001",
  type: "cart",
  itemCount: 3,
  promotions: [],
  items: [
    mockCartItem({
      id: "mock-item-1",
      productId: "mock-product-1",
      name: "Ember Glow Soy Candle",
      sku: "EW-EMB-001",
      quantity: 2,
      amount: 3800,
    }),
    mockCartItem({
      id: "mock-item-2",
      productId: "mock-product-2",
      name: "Midnight Wick Reed Diffuser",
      sku: "EW-MID-002",
      quantity: 1,
      amount: 2400,
    }),
  ],
  meta: {
    display_price: {
      without_tax: {
        amount: 10000,
        currency: "USD",
        float_price: 100,
        formatted: "$100.00",
      },
      tax: { amount: 825, currency: "USD", float_price: 8.25, formatted: "$8.25" },
      with_tax: {
        amount: 10825,
        currency: "USD",
        float_price: 108.25,
        formatted: "$108.25",
      },
    },
  },
};
