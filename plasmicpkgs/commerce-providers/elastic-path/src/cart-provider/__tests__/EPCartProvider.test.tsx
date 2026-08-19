// @jest-environment jsdom
import { resolveCartState } from "../EPCartProvider";
import type { Cart } from "../../types/cart";

const cart = { id: "cart-1", items: [{ id: "i1" }], itemCount: 2 } as Cart;
const emptyCart = { id: "cart-1", items: [], itemCount: 0 } as unknown as Cart;

describe("resolveCartState", () => {
  it("tells an empty cart apart from one that has not loaded", () => {
    expect(resolveCartState(null, true, null)).toBe("loading");
    expect(resolveCartState(emptyCart, false, null)).toBe("empty");
  });

  it("reports an error ahead of anything else", () => {
    expect(resolveCartState(cart, true, new Error("boom"))).toBe("error");
  });

  it("is ready once the cart has lines", () => {
    expect(resolveCartState(cart, false, null)).toBe("ready");
  });
});
