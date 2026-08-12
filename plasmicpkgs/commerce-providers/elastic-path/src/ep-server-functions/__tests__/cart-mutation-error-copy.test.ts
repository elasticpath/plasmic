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
});
