import { cartMutationErrorCopy } from "../cart-mutation-error-copy";

describe("cartMutationErrorCopy", () => {
  const generic = "Please try again.";

  it("maps insufficient_stock to shopper-facing copy", () => {
    const err = Object.assign(new Error("dispatch_failed"), {
      code: "insufficient_stock",
    });
    expect(cartMutationErrorCopy(err, generic)).toMatch(/enough stock/i);
  });

  it("maps no_session to shopper-facing copy", () => {
    const err = Object.assign(new Error("no_session"), { code: "no_session" });
    expect(cartMutationErrorCopy(err, generic)).toMatch(/session expired/i);
  });

  it("falls back for dispatch_failed without exposing the token", () => {
    const err = Object.assign(new Error("dispatch_failed"), {
      code: "dispatch_failed",
    });
    expect(cartMutationErrorCopy(err, generic)).toBe(generic);
  });

  it("passes through local authored messages without a code", () => {
    expect(cartMutationErrorCopy(new Error("Network error"), generic)).toBe(
      "Network error"
    );
  });

  it("falls back for route_not_found rather than showing the proxy's own text", () => {
    // A storefront that never mounted the proxy route answers with its own 404
    // page. Before that carried a code, this returned the raw
    // "ep proxy addCartItem failed (404)" straight to the shopper.
    const err = Object.assign(new Error("ep proxy addCartItem failed (404)"), {
      code: "route_not_found",
    });
    expect(cartMutationErrorCopy(err, generic)).toBe(generic);
  });
});
