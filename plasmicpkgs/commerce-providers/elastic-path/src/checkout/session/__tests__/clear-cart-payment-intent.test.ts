/**
 * clearCartPaymentIntentId — shared Cart PI detach helper.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  updateACart: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  updateACart: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { clearCartPaymentIntentId } = require("../clear-cart-payment-intent") as {
  clearCartPaymentIntentId: typeof import("../clear-cart-payment-intent").clearCartPaymentIntentId;
};

beforeEach(() => jest.clearAllMocks());

describe("clearCartPaymentIntentId", () => {
  it("PUTs empty payment_intent_id and returns ok", async () => {
    epSdk.updateACart.mockResolvedValue({ data: { data: { id: "cart-abc" } } });

    const result = await clearCartPaymentIntentId({
      client: {},
      cartId: "cart-abc",
    });

    expect(result).toEqual({ ok: true });
    expect(epSdk.updateACart).toHaveBeenCalledWith({
      client: {},
      path: { cartID: "cart-abc" },
      body: { data: { payment_intent_id: "" } },
    });
  });

  it("returns ok:false when updateACart soft-fails", async () => {
    epSdk.updateACart.mockResolvedValue({
      error: { message: "cart locked" },
    });

    const result = await clearCartPaymentIntentId({
      client: {},
      cartId: "cart-abc",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/cart locked/i);
    }
  });

  it("returns ok:false when updateACart throws", async () => {
    epSdk.updateACart.mockRejectedValue(new Error("network down"));

    const result = await clearCartPaymentIntentId({
      client: {},
      cartId: "cart-abc",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/network down/i);
    }
  });
});
