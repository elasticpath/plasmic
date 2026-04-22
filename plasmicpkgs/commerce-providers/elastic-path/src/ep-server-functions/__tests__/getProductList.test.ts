const mockGetByContextAllProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  getByContextAllProducts: (...args: unknown[]) =>
    mockGetByContextAllProducts(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetProductList } = require("../getProductList");

beforeEach(() => {
  mockGetByContextAllProducts.mockReset();
});

const makeProduct = (id: string, name: string) => ({
  id,
  type: "product",
  attributes: { name, slug: name.toLowerCase().replace(/ /g, "-") },
  meta: {
    display_price: {
      without_tax: { amount: 1000, currency: "USD", formatted: "$10.00" },
    },
    product_types: [],
  },
});

describe("epGetProductList", () => {
  it("returns normalized products from EP", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: {
        data: [makeProduct("p1", "Product One"), makeProduct("p2", "Product Two")],
        included: {},
      },
    });

    const result = await epGetProductList({
      limit: 10,
      auth: {
        accessToken: "tok",
        host: "https://api.ep.com",
        clientId: "cid",
      },
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("p1");
    expect(result[1].id).toBe("p2");
    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ "page[limit]": 10 }),
      })
    );
  });

  it("returns empty array when EP returns no products", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [], included: {} },
    });

    const result = await epGetProductList({
      auth: {
        accessToken: "tok",
        host: "https://api.ep.com",
        clientId: "cid",
      },
    });

    expect(result).toEqual([]);
  });

  it("returns empty array on error (graceful degradation)", async () => {
    mockGetByContextAllProducts.mockRejectedValue(new Error("EP down"));

    const result = await epGetProductList({
      auth: {
        accessToken: "tok",
        host: "https://api.ep.com",
        clientId: "cid",
      },
    });

    expect(result).toEqual([]);
  });
});
