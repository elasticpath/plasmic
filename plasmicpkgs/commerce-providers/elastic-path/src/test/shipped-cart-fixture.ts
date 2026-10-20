/**
 * A cart the checkout wrote its shipping line into, as read from the
 * integration store: one product, the checkout's $5.99 shipping line and
 * TEST1 (10% off the cart, shipping included).
 */
const usd = (amount: number) => ({
  amount,
  currency: "USD",
  formatted: `${amount < 0 ? "-" : ""}$${(Math.abs(amount) / 100).toFixed(2)}`,
});
const pair = (amount: number) => ({ unit: usd(amount), value: usd(amount) });

export const SHIPPED_CART_RESPONSE = {
  data: {
    id: "cart-1",
    type: "cart",
    meta: {
      display_price: {
        with_tax: usd(2519),
        without_tax: usd(2519),
        tax: usd(0),
        discount: usd(-280),
        without_discount: usd(2799),
      },
    },
  },
  included: {
    items: [
      {
        id: "line-1",
        type: "cart_item",
        sku: "p-plus-sub",
        name: "PlayStation Plus",
        quantity: 1,
        meta: {
          display_price: {
            with_tax: pair(1980),
            without_tax: pair(1980),
            tax: pair(0),
            discount: pair(-220),
            without_discount: pair(2200),
            discounts: { TEST1: usd(-220) },
          },
        },
      },
      {
        id: "ship-1",
        type: "custom_item",
        sku: "__ep_shipping",
        name: "Standard Shipping",
        quantity: 1,
        unit_price: { amount: 599, currency: "USD", includes_tax: true },
        meta: {
          display_price: {
            with_tax: pair(539),
            without_tax: pair(539),
            tax: pair(0),
            discount: pair(-60),
            without_discount: pair(599),
            discounts: { TEST1: usd(-60) },
          },
        },
      },
      {
        id: "promo-1",
        type: "promotion_item",
        sku: "TEST1",
        quantity: 1,
        meta: {
          display_price: {
            with_tax: pair(-280),
            without_tax: pair(-280),
          },
        },
      },
    ],
  },
} as any;
