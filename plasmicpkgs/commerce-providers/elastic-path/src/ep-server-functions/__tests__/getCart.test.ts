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

beforeEach(() => {
  mockGetACart.mockReset();
});

describe("epGetCart", () => {
  it("returns a normalized cart for the given cartId", async () => {
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

    const result = await epGetCart({
      auth: {
        accessToken: "tok",
        host: "https://api.ep.com",
        clientId: "cid",
        cartId: "cart-id",
      },
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe("cart-id");
    expect(mockGetACart).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id" },
      })
    );
  });

  it("returns null when no cartId is present (anonymous visitor, no cart yet)", async () => {
    const result = await epGetCart({
      auth: {
        accessToken: "tok",
        host: "https://api.ep.com",
        clientId: "cid",
      },
    });

    expect(result).toBeNull();
    expect(mockGetACart).not.toHaveBeenCalled();
  });

  it("returns null when EP throws (stale cartId, cart deleted, network error)", async () => {
    mockGetACart.mockRejectedValue(new Error("404 cart not found"));

    const result = await epGetCart({
      auth: {
        accessToken: "tok",
        host: "https://api.ep.com",
        clientId: "cid",
        cartId: "stale-cart-id",
      },
    });

    expect(result).toBeNull();
  });
});
