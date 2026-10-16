/**
 * Cart Cleanup Operation — runs after a successful order is created.
 *
 * Slice 1 (this PR): anonymous guest only. Cleanup deletes the EP cart so
 * the next add-to-cart action lazily creates a fresh one. Account
 * dissociation is added in slice 2 (account checkout).
 *
 * Cleanup failures are logged but never thrown — the order is genuine.
 * `runCartCleanup` resolves to whether Elastic Path then reports the cart
 * empty.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() for the SDK
 * mock so interception works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  deleteACart: jest.fn(),
  deleteAllCartItems: jest.fn(),
  getCartItems: jest.fn(),
  updateACart: jest.fn(),
  createShopperClient: jest.fn(() => ({ client: {} })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  deleteACart: jest.Mock;
  deleteAllCartItems: jest.Mock;
  getCartItems: jest.Mock;
  updateACart: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runCartCleanup } = require("../cart-cleanup") as {
  runCartCleanup: typeof import("../cart-cleanup").runCartCleanup;
};

const CONFIG = {
  host: "https://api.test.elasticpath.com",
  clientId: "test-client-id",
  getClientCredentialsToken: jest.fn(async () => "admin-token"),
};

beforeEach(() => {
  jest.clearAllMocks();
  epSdk.getCartItems.mockResolvedValue({ data: { data: [] } });
  epSdk.deleteAllCartItems.mockResolvedValue({ data: {} });
  epSdk.updateACart.mockResolvedValue({ data: { data: {} } });
});

describe("runCartCleanup (guest happy path)", () => {
  it("deletes the EP cart with admin auth", async () => {
    epSdk.deleteACart.mockResolvedValue({ data: undefined });

    await runCartCleanup({ ...CONFIG, cartId: "cart-abc" });

    expect(CONFIG.getClientCredentialsToken).toHaveBeenCalledTimes(1);
    expect(epSdk.deleteACart).toHaveBeenCalledTimes(1);
    expect(epSdk.deleteACart.mock.calls[0][0]).toMatchObject({
      path: { cartID: "cart-abc" },
    });
  });

  it("reports a clean cart once Elastic Path shows it empty", async () => {
    epSdk.deleteACart.mockResolvedValue({ data: undefined });

    await expect(runCartCleanup({ ...CONFIG, cartId: "cart-abc" })).resolves.toBe(true);
  });

  it("empties and unlinks a cart Elastic Path will not delete (an account's last cart)", async () => {
    epSdk.deleteACart.mockResolvedValue({
      error: { errors: [{ status: 400, title: "Last cart" }] },
      response: { status: 400 },
    });

    await expect(runCartCleanup({ ...CONFIG, cartId: "cart-abc" })).resolves.toBe(true);
    expect(epSdk.deleteAllCartItems).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-abc" } })
    );
    expect(epSdk.updateACart).toHaveBeenCalledWith(
      expect.objectContaining({ body: { data: { payment_intent_id: "" } } })
    );
  });

  it("does not throw, and reports failure, when the cart still holds lines", async () => {
    epSdk.deleteACart.mockRejectedValue(new Error("EP unavailable"));
    epSdk.getCartItems.mockResolvedValue({ data: { data: [{ id: "line-1", quantity: 1 }] } });

    await expect(runCartCleanup({ ...CONFIG, cartId: "cart-abc" })).resolves.toBe(false);
  });

  it("does nothing when cartId is empty", async () => {
    await runCartCleanup({ ...CONFIG, cartId: "" });

    expect(epSdk.deleteACart).not.toHaveBeenCalled();
  });
});
