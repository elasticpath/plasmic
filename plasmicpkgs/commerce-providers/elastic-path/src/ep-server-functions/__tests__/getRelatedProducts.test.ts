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
        query: expect.objectContaining({ include: ["main_image", "files"] }),
      })
    );
  });

  it("gives each product its main image, or its first file when it has none", async () => {
    const product = (id: string, relationships: Record<string, unknown>) => ({
      id,
      type: "product",
      attributes: { name: id },
      relationships,
      meta: { product_types: [] },
    });
    mockGetByContextAllRelatedProducts.mockResolvedValue({
      data: {
        data: [
          product("with-main", {
            main_image: { data: { id: "img-1", type: "main_image" } },
            files: { data: [{ id: "file-1", type: "file" }] },
          }),
          product("files-only", {
            files: { data: [{ id: "file-2", type: "file" }] },
          }),
          product("no-images", {}),
        ],
        included: {
          main_images: [
            { id: "img-1", link: { href: "https://files.test/main-1.jpg" } },
          ],
          files: [
            { id: "file-1", link: { href: "https://files.test/file-1.jpg" } },
            { id: "file-2", link: { href: "https://files.test/file-2.jpg" } },
          ],
        },
      },
    });

    const result = await withEpSession(SESSION, () =>
      epGetRelatedProducts({
        productId: "base-id",
        relationshipSlug: "CRP_related_products",
      })
    );

    expect(result[0].images[0].url).toBe("https://files.test/main-1.jpg");
    expect(result[1].images[0].url).toBe("https://files.test/file-2.jpg");
    expect(result[2].images).toEqual([]);
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
