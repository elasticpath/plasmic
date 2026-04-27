const mockGetACart = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  getACart: (...args: unknown[]) => mockGetACart(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetCart } = require("../getCart");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION_BASE = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
  serverCartMode: false,
};

beforeEach(() => {
  mockGetACart.mockReset();
});

describe("epGetCart", () => {
  it("returns a normalized cart for the cartId carried by the ALS session", async () => {
    mockGetACart.mockResolvedValue({
      data: {
        data: {
          id: "cart-id",
          type: "cart",
          attributes: { name: "Cart" },
          meta: {
            display_price: {
              with_tax: {
                amount: 5000,
                currency: "USD",
                formatted: "$50.00",
              },
              without_tax: {
                amount: 5000,
                currency: "USD",
                formatted: "$50.00",
              },
            },
          },
        },
        included: { items: [] },
      },
    });

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id" },
      () => epGetCart()
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe("cart-id");
    expect(mockGetACart).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id" },
      })
    );
  });

  it("returns null when no cartId is on the ALS session (anonymous visitor)", async () => {
    const result = await withEpSession(SESSION_BASE, () => epGetCart());

    expect(result).toBeNull();
    expect(mockGetACart).not.toHaveBeenCalled();
  });

  it("returns null when called outside any withEpSession scope", async () => {
    const result = await epGetCart();

    expect(result).toBeNull();
    expect(mockGetACart).not.toHaveBeenCalled();
  });

  it("returns null when EP throws (stale cartId, cart deleted, network error)", async () => {
    mockGetACart.mockRejectedValue(new Error("404 cart not found"));

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "stale-cart-id" },
      () => epGetCart()
    );

    expect(result).toBeNull();
  });
});
