// @jest-environment jsdom
import { deriveCartContext } from "../EPCartProvider";
import type { Cart } from "../../types/cart";

const baseCart: Cart = {
  id: "cart-1",
  customerId: "",
  email: "",
  createdAt: "2026-01-01T00:00:00Z",
  currency: { code: "USD" },
  taxesIncluded: true,
  lineItems: [],
  lineItemsSubtotalPrice: 0,
  subtotalPrice: 0,
  totalPrice: 0,
  discounts: [],
};

describe("deriveCartContext", () => {
  it("exposes empty defaults for $ctx.cart when there is no cart", () => {
    const ctx = deriveCartContext(null, false, null);

    expect(ctx.cart).toBeNull();
    expect(ctx.items).toEqual([]);
    expect(ctx.itemCount).toBe(0);
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.totals).toEqual({ subtotal: 0, total: 0, currency: "USD" });
  });

  it("derives itemCount as the sum of line-item quantities", () => {
    const cart: Cart = {
      ...baseCart,
      lineItems: [
        { id: "i1", quantity: 2 } as any,
        { id: "i2", quantity: 3 } as any,
      ],
    };

    const ctx = deriveCartContext(cart, false, null);

    expect(ctx.itemCount).toBe(5);
    expect(ctx.isEmpty).toBe(false);
    expect(ctx.items).toHaveLength(2);
  });

  it("propagates totals + currency from the cart shape", () => {
    const cart: Cart = {
      ...baseCart,
      subtotalPrice: 50,
      totalPrice: 60,
      currency: { code: "EUR" },
      lineItems: [{ id: "i1", quantity: 1 } as any],
    };

    const ctx = deriveCartContext(cart, false, null);

    expect(ctx.totals).toEqual({ subtotal: 50, total: 60, currency: "EUR" });
  });

  it("forwards loading / error flags so descendants can style their own variants", () => {
    const err = new Error("boom");
    const ctx = deriveCartContext(null, true, err);

    expect(ctx.isLoading).toBe(true);
    expect(ctx.error).toBe(err);
  });
});
