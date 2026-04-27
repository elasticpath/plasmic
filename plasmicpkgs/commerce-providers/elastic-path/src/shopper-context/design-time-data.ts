import type { CheckoutCartData } from "./use-checkout-cart";

/**
 * Mock cart data for Plasmic Studio design-time preview.
 *
 * Uses Ember & Wick product names so designers see realistic candle/diffuser
 * data while styling checkout components. Prices use minor units (cents) to
 * match the real EP API response shape.
 */
export const MOCK_SERVER_CART_DATA: CheckoutCartData = {
  id: "mock-cart-001",
  items: [
    {
      id: "mock-item-1",
      productId: "mock-product-1",
      name: "Ember Glow Soy Candle",
      sku: "EW-EMB-001",
      quantity: 2,
      unitPrice: 3800,
      linePrice: 7600,
      formattedUnitPrice: "$38.00",
      formattedLinePrice: "$76.00",
      imageUrl: null,
    },
    {
      id: "mock-item-2",
      productId: "mock-product-2",
      name: "Midnight Wick Reed Diffuser",
      sku: "EW-MID-002",
      quantity: 1,
      unitPrice: 2400,
      linePrice: 2400,
      formattedUnitPrice: "$24.00",
      formattedLinePrice: "$24.00",
      imageUrl: null,
    },
  ],
  itemCount: 3,
  subtotal: 10000,
  tax: 825,
  shipping: 0,
  total: 10825,
  formattedSubtotal: "$100.00",
  formattedTax: "$8.25",
  formattedShipping: "$0.00",
  formattedTotal: "$108.25",
  currencyCode: "USD",
  showImages: true,
  hasPromo: false,
  promoCode: null,
  promoDiscount: 0,
  formattedPromoDiscount: null,
};
