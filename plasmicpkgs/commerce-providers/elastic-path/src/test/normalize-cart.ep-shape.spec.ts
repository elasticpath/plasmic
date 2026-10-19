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

  it("keeps the promotion where the promo input can find it", () => {
    // Filtering promotions out of the lines is right, but dropping them
    // altogether left nothing to rehydrate "TEST1 applied" from after a
    // navigation.
    const cart = normalizeCart({
      ...cartResponse,
      included: {
        items: [
          { id: "line-1", type: "cart_item", quantity: 1 },
          {
            id: "promo-1",
            type: "promotion_item",
            name: "Test 10% off cart",
            quantity: 1,
          },
        ] as any,
      },
    });

    expect(cart.items.map((i) => i.id)).toEqual(["line-1"]);
    expect(cart.promotions.map((p) => p.name)).toEqual(["Test 10% off cart"]);
  });

  it("reports no promotions on a cart that has none", () => {
    expect(normalizeCart(cartResponse).promotions).toEqual([]);
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

  describe("a cart the checkout wrote its shipping line into", () => {
    // Shape read from the integration store: one product, the checkout's
    // $5.99 shipping line and TEST1 (10% off the cart, shipping included).
    const usd = (amount: number) => ({
      amount,
      currency: "USD",
      formatted: `${amount < 0 ? "-" : ""}$${(Math.abs(amount) / 100).toFixed(2)}`,
    });
    const pair = (amount: number) => ({ unit: usd(amount), value: usd(amount) });
    const shipped = {
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

    it("lists and counts only what the shopper bought", () => {
      const cart = normalizeCart(shipped);

      expect(cart.items.map((i) => i.name)).toEqual(["PlayStation Plus"]);
      expect(cart.itemCount).toBe(1);
    });

    it("totals the cart without the shipping or what the code took off it", () => {
      const price = normalizeCart(shipped).meta?.display_price as any;

      expect(price.with_tax).toMatchObject({ amount: 1980, formatted: "$19.80" });
      expect(price.without_tax.amount).toBe(1980);
      expect(price.discount).toMatchObject({ amount: -220, formatted: "-$2.20" });
      expect(price.without_discount.amount).toBe(2200);
      expect(price.tax.amount).toBe(0);
    });

    it("shows the code's discount on the cart's own lines", () => {
      const [promo] = normalizeCart(shipped).promotions as any[];

      expect(promo.meta.display_price.without_tax.value).toMatchObject({
        amount: -220,
        formatted: "-$2.20",
      });
    });

    it("leaves a cart with no shipping line as Elastic Path priced it", () => {
      const cart = normalizeCart({
        ...shipped,
        included: {
          items: shipped.included.items.filter((i: any) => i.id !== "ship-1"),
        },
      });

      expect((cart.meta?.display_price as any).with_tax.formatted).toBe("$25.19");
      expect((cart.promotions[0] as any).meta.display_price.without_tax.value.amount).toBe(-280);
    });
  });

  it("publishes nothing that carries the cart id", () => {
    const cartId = "5a1d2c3e-0f4b-4c8e-9d7a-1b2c3d4e5f60";
    const cart = normalizeCart({
      data: {
        ...cartResponse.data,
        id: cartId,
        name: "Cart",
        description: "Shopping cart",
        payment_intent_id: "pi_3Q0abc",
        links: { self: `https://api.test.com/v2/carts/${cartId}` },
        relationships: {
          items: { data: [{ type: "cart_item", id: "line-1" }] },
          accounts: { data: [{ type: "account", id: "acct-1" }] },
        },
      },
      included: cartResponse.included,
    });

    expect(JSON.stringify(cart)).not.toContain(cartId);
    expect(cart).not.toHaveProperty("id");
    expect(cart).not.toHaveProperty("links");
    expect(cart.name).toBe("Cart");
    expect(cart.relationships?.accounts).toEqual({
      data: [{ type: "account", id: "acct-1" }],
    });
  });
});
