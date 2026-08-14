const mockGetByContextAllRelatedProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  getByContextAllRelatedProducts: (...args: unknown[]) =>
    mockGetByContextAllRelatedProducts(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetRelatedProducts } = require("../getRelatedProducts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

beforeEach(() => {
  mockGetByContextAllRelatedProducts.mockReset();
});

const mkProduct = (id: string, name: string) => ({
  id,
  type: "product",
  attributes: { name },
  meta: {
    display_price: {
      without_tax: { amount: 1000, currency: "USD", formatted: "$10.00" },
    },
    product_types: [],
  },
});

describe("epGetRelatedProducts", () => {
  it("returns related products for the given productId + relationshipSlug", async () => {
    mockGetByContextAllRelatedProducts.mockResolvedValue({
      data: {
        data: [mkProduct("r1", "Related One"), mkProduct("r2", "Related Two")],
        included: {},
      },
    });

    const result = await withEpSession(SESSION, () =>
      epGetRelatedProducts({
        productId: "base-id",
        relationshipSlug: "CRP_related_products",
        limit: 4,
      })
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("r1");
    expect(mockGetByContextAllRelatedProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({
          product_id: "base-id",
          custom_relationship_slug: "CRP_related_products",
        }),
      })
    );
  });

  it("returns empty array when productId or relationshipSlug is missing", async () => {
    const noProductId = await withEpSession(SESSION, () =>
      epGetRelatedProducts({
        productId: "",
        relationshipSlug: "CRP_related_products",
      })
    );
    expect(noProductId).toEqual([]);

    const noSlug = await withEpSession(SESSION, () =>
      epGetRelatedProducts({
        productId: "base-id",
        relationshipSlug: "",
      })
    );
    expect(noSlug).toEqual([]);
    expect(mockGetByContextAllRelatedProducts).not.toHaveBeenCalled();
  });

  it("returns empty array when called outside withEpSession", async () => {
    const result = await epGetRelatedProducts({
      productId: "base-id",
      relationshipSlug: "CRP_related_products",
    });
    expect(result).toEqual([]);
    expect(mockGetByContextAllRelatedProducts).not.toHaveBeenCalled();
  });

  it("returns empty array on error", async () => {
    mockGetByContextAllRelatedProducts.mockRejectedValue(
      new Error("not found")
    );

    const result = await withEpSession(SESSION, () =>
      epGetRelatedProducts({
        productId: "base-id",
        relationshipSlug: "CRP_related_products",
      })
    );
    expect(result).toEqual([]);
  });
});
