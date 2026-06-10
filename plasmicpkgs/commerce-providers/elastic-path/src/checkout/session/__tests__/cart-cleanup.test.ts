/**
 * Cart Cleanup Operation — runs after a successful order is created.
 *
 * Slice 1 (this PR): anonymous guest only. Cleanup deletes the EP cart so
 * the next add-to-cart action lazily creates a fresh one. Account
 * dissociation is added in slice 2 (account checkout).
 *
 * Cleanup failures are logged but never propagate — the order is genuine,
 * cleanup is housekeeping. `runCartCleanup` returns void on both paths.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() for the SDK
 * mock so interception works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  deleteACart: jest.fn(),
  createShopperClient: jest.fn(() => ({ client: {} })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  deleteACart: jest.Mock;
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

beforeEach(() => jest.clearAllMocks());

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

  it("swallows errors from deleteACart and resolves successfully", async () => {
    epSdk.deleteACart.mockRejectedValue(new Error("EP unavailable"));

    await expect(
      runCartCleanup({ ...CONFIG, cartId: "cart-abc" })
    ).resolves.toBeUndefined();
  });

  it("does nothing when cartId is empty", async () => {
    await runCartCleanup({ ...CONFIG, cartId: "" });

    expect(epSdk.deleteACart).not.toHaveBeenCalled();
  });
});
