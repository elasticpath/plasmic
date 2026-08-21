import type { CartEntityResponse } from "@epcc-sdk/sdks-shopper";
import { normalizeCart } from "../utils/normalize";

const cartResponse: CartEntityResponse = {
  data: {
    id: "cart-1",
    type: "cart",
    meta: {
      display_price: {
        without_tax: { amount: 2000, currency: "USD", formatted: "$20.00" },
        tax: { amount: 400, currency: "USD", formatted: "$4.00" },
        with_tax: { amount: 2400, currency: "USD", formatted: "$24.00" },
      },
      timestamps: { created_at: "2026-08-18T09:00:00Z" },
    },
  },
  included: {
    items: [
      {
        id: "line-1",
        type: "cart_item",
        product_id: "child-s",
        name: "Merino Jumper Small",
        sku: "MJ-S",
        quantity: 2,
        custom_inputs: {
          _selectedOptions: [{ id: "var-size", name: "Size", value: "Small" }],
        },
        location: "warehouse-north",
        meta: {
          display_price: {
            without_tax: {
              unit: { amount: 7999, currency: "GBP", formatted: "£79.99" },
              value: { amount: 15998, currency: "GBP", formatted: "£159.98" },
            },
          },
        },
      } as any,
    ],
  },
};

describe("normalizeCart", () => {
  it("keeps Elastic Path's three cart totals distinct", () => {
    const cart = normalizeCart(cartResponse);

    expect(cart.meta?.display_price?.without_tax?.formatted).toBe("$20.00");
    expect(cart.meta?.display_price?.tax?.formatted).toBe("$4.00");
    expect(cart.meta?.display_price?.with_tax?.formatted).toBe("$24.00");
  });

  it("fills in the decimal Elastic Path omits on line prices", () => {
    const cart = normalizeCart(cartResponse);

    expect(cart.items[0].meta?.display_price?.without_tax).toEqual({
      unit: {
        amount: 7999,
        currency: "GBP",
        formatted: "£79.99",
        float_price: 79.99,
      },
      value: {
        amount: 15998,
        currency: "GBP",
        formatted: "£159.98",
        float_price: 159.98,
      },
    });
  });

  it("counts units, not lines", () => {
    const cart = normalizeCart({
      ...cartResponse,
      included: {
        items: [
          { id: "line-1", type: "cart_item", quantity: 2 },
          { id: "line-2", type: "cart_item", quantity: 3 },
        ] as any,
      },
    });

    expect(cart.items).toHaveLength(2);
    expect(cart.itemCount).toBe(5);
  });

  it("leaves promotions out of the lines and the count", () => {
    // EP returns an applied promotion as a promotion_item alongside the real
    // lines. Rendered as one, it got an image, a quantity stepper and a Remove
    // button, and it inflated itemCount.
    const cart = normalizeCart({
      ...cartResponse,
      included: {
        items: [
          { id: "line-1", type: "cart_item", quantity: 1 },
          { id: "promo-1", type: "promotion_item", quantity: 1 },
        ] as any,
      },
    });

    expect(cart.items.map((i) => i.id)).toEqual(["line-1"]);
    expect(cart.itemCount).toBe(1);
  });

  it("keeps a custom_item, which is a real line the shopper added", () => {
    const cart = normalizeCart({
      ...cartResponse,
      included: {
        items: [
          { id: "line-1", type: "cart_item", quantity: 1 },
          { id: "adj-1", type: "custom_item", quantity: 1 },
        ] as any,
      },
    });

    expect(cart.items.map((i) => i.id)).toEqual(["line-1", "adj-1"]);
    expect(cart.itemCount).toBe(2);
  });

  it("passes the line through verbatim, including fields the SDK type omits", () => {
    const [line] = normalizeCart(cartResponse).items;

    expect(line).toMatchObject({
      id: "line-1",
      product_id: "child-s",
      name: "Merino Jumper Small",
      sku: "MJ-S",
      quantity: 2,
      location: "warehouse-north",
      custom_inputs: {
        _selectedOptions: [{ id: "var-size", name: "Size", value: "Small" }],
      },
    });
  });
});
