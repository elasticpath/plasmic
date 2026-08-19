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
