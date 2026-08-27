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
const { epGetProductPage } = require("../getProductPage");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

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

describe("epGetProductPage", () => {
  it("returns EP's envelope with data and counts", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: {
        data: [makeProduct("p1", "One"), makeProduct("p2", "Two")],
        included: {},
        meta: { results: { total: 57 }, page: { limit: 2, offset: 4 } },
      },
    });

    const result = await withEpSession(SESSION, () =>
      epGetProductPage({ limit: 2, offset: 4 })
    );

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe("p1");
    expect(result.meta).toEqual({
      results: { total: 57 },
      page: { limit: 2, offset: 4 },
    });
    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          "page[limit]": 2,
          "page[offset]": 4,
        }),
      })
    );
  });

  /**
   * EP types these counts as BigInt, which `JSON.stringify` throws on. The
   * value crosses that boundary twice — into the loader's prefetched query
   * data and through the proxy route — so the coercion is load-bearing.
   */
  it("coerces BigInt counts to numbers so the page can be serialized", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: {
        data: [makeProduct("p1", "One")],
        meta: {
          results: { total: BigInt(120) },
          page: { limit: BigInt(12), offset: BigInt(24) },
        },
      },
    });

    const result = await withEpSession(SESSION, () =>
      epGetProductPage({ limit: 12, offset: 24 })
    );

    expect(typeof result.meta.results.total).toBe("number");
    expect(result.meta.results.total).toBe(120);
    expect(typeof result.meta.page.limit).toBe("number");
    expect(typeof result.meta.page.offset).toBe("number");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("falls back to the row count when EP reports no total", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [makeProduct("p1", "One"), makeProduct("p2", "Two")] },
    });

    const result = await withEpSession(SESSION, () => epGetProductPage({}));

    expect(result.meta.results.total).toBe(2);
    expect(result.meta.page.limit).toBe(25);
    expect(result.meta.page.offset).toBe(0);
  });

  it("combines search and category into one EP filter expression", async () => {
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

    await withEpSession(SESSION, () =>
      epGetProductPage({ search: "chair", categoryId: "cat-1" })
    );

    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          filter: "and(eq(name,chair),eq(category.id,cat-1))",
        }),
      })
    );
  });

  it.each([
    ["chair", undefined, "eq(name,chair)"],
    [undefined, "cat-1", "eq(category.id,cat-1)"],
  ])(
    "wraps a lone filter term without and() (search=%s category=%s)",
    async (search, categoryId, expected) => {
      mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

      await withEpSession(SESSION, () =>
        epGetProductPage({ search, categoryId })
      );

      expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ filter: expected }),
        })
      );
    }
  );

  it("returns an empty page rather than throwing when EP errors", async () => {
    mockGetByContextAllProducts.mockRejectedValue(new Error("boom"));

    const result = await withEpSession(SESSION, () =>
      epGetProductPage({ limit: 5, offset: 10 })
    );

    expect(result).toEqual({
      data: [],
      meta: { results: { total: 0 }, page: { limit: 5, offset: 10 } },
    });
  });

  it("returns an empty page when there is no usable session", async () => {
    const result = await epGetProductPage({ limit: 5 });

    expect(result.data).toEqual([]);
    expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
  });
});
