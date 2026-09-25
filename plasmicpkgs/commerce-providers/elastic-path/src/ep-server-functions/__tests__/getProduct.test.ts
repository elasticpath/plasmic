// NOTE: esbuild hoists ES `import` to require() at the top, BEFORE jest.mock
// calls (same trick as src/bundle/__tests__/use-parent-products.test.tsx).
// Declare mocks up here so the factory references stable module-scope vars,
// then require() the code under test so it loads AFTER mocks are registered.

const mockGetByContextProduct = jest.fn();
const mockGetByContextAllProducts = jest.fn();
const mockGetByContextChildProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  getByContextProduct: (...args: unknown[]) =>
    mockGetByContextProduct(...args),
  getByContextAllProducts: (...args: unknown[]) =>
    mockGetByContextAllProducts(...args),
  getByContextChildProducts: (...args: unknown[]) =>
    mockGetByContextChildProducts(...args),
}));

const mockShouldUseProxy = jest.fn(() => false);
const mockCallEpProxy = jest.fn();
jest.mock("../proxy-fetch", () => ({
  shouldUseProxy: () => mockShouldUseProxy(),
  callEpProxy: (...args: unknown[]) => mockCallEpProxy(...args),
}));

const mockWarn = jest.fn();
jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetProduct } = require("../getProduct");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const TEST_SESSION = {
  accessToken: "token-abc",
  host: "https://api.test.elasticpath.com",
  clientId: "client-xyz",
};

const PRODUCT_ID = "3f0c6d1e-8a2b-4c5d-9e7f-0a1b2c3d4e5f";
const CHILD_ID = "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
const PARENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function productRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "product",
    attributes: { name: `Product ${id}`, slug: `slug-${id}` },
    meta: {
      display_price: { without_tax: { amount: 1500, currency: "USD" } },
      product_types: [],
    },
    ...extra,
  };
}

const byId = (row: unknown) => ({ data: { data: row, included: {} } });
const bySlug = (rows: unknown[]) => ({
  data: { data: rows, included: {}, meta: { results: { total: rows.length } } },
});
const notFound = { data: undefined, error: { errors: [] }, response: { status: 404 } };

const inSession = (fn: () => Promise<unknown>) => withEpSession(TEST_SESSION, fn);

beforeEach(() => {
  mockGetByContextProduct.mockReset();
  mockGetByContextAllProducts.mockReset();
  mockGetByContextChildProducts.mockReset();
  mockShouldUseProxy.mockReset();
  mockShouldUseProxy.mockReturnValue(false);
  mockCallEpProxy.mockReset();
  mockWarn.mockReset();
});

describe("epGetProduct", () => {
  it("returns a normalized product when EP returns a standalone product", async () => {
    mockGetByContextProduct.mockResolvedValue(
      byId(
        productRow(PRODUCT_ID, {
          attributes: {
            name: "Test Product",
            slug: "test-product",
            sku: "TEST-SKU",
            description: "A lovely product",
          },
        })
      )
    );

    const result = await inSession(() => epGetProduct({ id: PRODUCT_ID }));

    expect(result).not.toBeNull();
    expect(result?.id).toBe(PRODUCT_ID);
    expect(result?.attributes?.name).toBe("Test Product");
    expect(mockGetByContextProduct).toHaveBeenCalledTimes(1);
    expect(mockGetByContextProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { product_id: PRODUCT_ID },
      })
    );
  });

  // When called outside any withEpSession scope (typical in Studio canvas,
  // where the loader runs in the browser without ALS), epGetProduct must
  // fail-soft and return null — NOT throw. Designers see an empty preview
  // instead of a crashed query panel.
  it("returns null when called outside withEpSession", async () => {
    const result = await epGetProduct({ id: PRODUCT_ID });

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  // Same contract when the ALS session is half-populated — host,
  // clientId, or accessToken missing. Return null upstream so the
  // emptyContent slot renders instead of an unauthenticated SDK call.
  it("returns null when ALS session is missing required fields", async () => {
    const result = await withEpSession(
      { host: "", clientId: "x", accessToken: "y" } as any,
      () => epGetProduct({ id: PRODUCT_ID })
    );

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  it("returns null when id is empty without calling EP", async () => {
    const result = await inSession(() => epGetProduct({ id: "" }));

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
    expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
  });

  it("fetches parent and attaches __initialVariantId when id points at a child variant", async () => {
    mockGetByContextProduct
      .mockResolvedValueOnce(
        byId(
          productRow(CHILD_ID, {
            attributes: { name: "Child Variant", base_product_id: PARENT_ID },
            meta: { product_types: ["child"] },
          })
        )
      )
      .mockResolvedValueOnce(
        byId(
          productRow(PARENT_ID, {
            attributes: { name: "Parent Product" },
            meta: { product_types: ["parent"] },
          })
        )
      );

    const result = await inSession(() => epGetProduct({ id: CHILD_ID }));

    expect(result?.id).toBe(PARENT_ID);
    expect(result?.attributes?.name).toBe("Parent Product");
    expect((result as { __initialVariantId?: string }).__initialVariantId).toBe(
      CHILD_ID
    );
    expect(mockGetByContextProduct).toHaveBeenCalledTimes(2);
    expect(mockGetByContextProduct).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: { product_id: PARENT_ID } })
    );
  });

  describe("product reference", () => {
    it("reads a slug with one filtered request carrying the single read's includes", async () => {
      mockGetByContextAllProducts.mockResolvedValue(
        bySlug([productRow(PRODUCT_ID, { attributes: { slug: "blue-shirt" } })])
      );

      const result = await inSession(() => epGetProduct({ id: "blue-shirt" }));

      expect(result?.id).toBe(PRODUCT_ID);
      expect(mockGetByContextProduct).not.toHaveBeenCalled();
      expect(mockGetByContextAllProducts).toHaveBeenCalledTimes(1);
      expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            filter: "eq(slug,blue-shirt)",
            "page[limit]": 1,
            include: ["main_image", "files", "component_products"],
          }),
        })
      );
    });

    it("joins images from the slug read's included block", async () => {
      mockGetByContextAllProducts.mockResolvedValue({
        data: {
          data: [
            productRow(PRODUCT_ID, {
              relationships: { main_image: { data: { id: "img-1" } } },
            }),
          ],
          included: {
            main_images: [
              { id: "img-1", link: { href: "https://cdn.test/img-1.png" } },
            ],
          },
        },
      });

      const result = await inSession(() => epGetProduct({ id: "blue-shirt" }));

      expect(result?.images?.[0]?.url).toBe("https://cdn.test/img-1.png");
    });

    it("reads a UUID-shaped reference by id without a slug read", async () => {
      mockGetByContextProduct.mockResolvedValue(byId(productRow(PRODUCT_ID)));

      const result = await inSession(() => epGetProduct({ id: PRODUCT_ID }));

      expect(result?.id).toBe(PRODUCT_ID);
      expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
    });

    it("reads a UUID-shaped reference by slug when no product has that id", async () => {
      mockGetByContextProduct.mockResolvedValue(notFound);
      mockGetByContextAllProducts.mockResolvedValue(
        bySlug([productRow(PRODUCT_ID)])
      );

      const result = await inSession(() => epGetProduct({ id: CHILD_ID }));

      expect(result?.id).toBe(PRODUCT_ID);
      expect(mockGetByContextProduct).toHaveBeenCalledWith(
        expect.objectContaining({ path: { product_id: CHILD_ID } })
      );
      expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ filter: `eq(slug,${CHILD_ID})` }),
        })
      );
    });

    it("returns null and warns with the reference and lookups when nothing matches", async () => {
      mockGetByContextProduct.mockResolvedValue(notFound);
      mockGetByContextAllProducts.mockResolvedValue(bySlug([]));

      const result = await inSession(() => epGetProduct({ id: PRODUCT_ID }));

      expect(result).toBeNull();
      expect(mockWarn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reference: PRODUCT_ID,
          lookups: ["id", "slug"],
        })
      );
      expect(JSON.stringify(mockWarn.mock.calls)).not.toContain(
        TEST_SESSION.accessToken
      );
    });

    it("warns with only the slug lookup for a non-UUID reference", async () => {
      mockGetByContextAllProducts.mockResolvedValue(bySlug([]));

      const result = await inSession(() => epGetProduct({ id: "gone" }));

      expect(result).toBeNull();
      expect(mockGetByContextProduct).not.toHaveBeenCalled();
      expect(mockWarn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ reference: "gone", lookups: ["slug"] })
      );
    });

    it("preselects the child a slug names, reading the family by resolved ids", async () => {
      mockGetByContextAllProducts.mockResolvedValue(
        bySlug([
          productRow(CHILD_ID, {
            attributes: { slug: "shirt-red-m", base_product_id: PARENT_ID },
            meta: { product_types: ["child"] },
          }),
        ])
      );
      mockGetByContextProduct.mockResolvedValue(
        byId(
          productRow(PARENT_ID, {
            meta: {
              product_types: ["parent"],
              variations: [{ id: "v1", name: "Colour", options: [] }],
            },
          })
        )
      );
      mockGetByContextChildProducts.mockResolvedValue({ data: { data: [] } });

      const result = await inSession(() => epGetProduct({ id: "shirt-red-m" }));

      expect(result?.id).toBe(PARENT_ID);
      expect((result as { __initialVariantId?: string }).__initialVariantId).toBe(
        CHILD_ID
      );
      expect(mockGetByContextProduct).toHaveBeenCalledWith(
        expect.objectContaining({ path: { product_id: PARENT_ID } })
      );
      expect(mockGetByContextChildProducts).toHaveBeenCalledWith(
        expect.objectContaining({ path: { product_id: PARENT_ID } })
      );
    });

    it("reads a slug base product's children by its resolved id", async () => {
      mockGetByContextAllProducts.mockResolvedValue(
        bySlug([
          productRow(PARENT_ID, {
            meta: {
              product_types: ["parent"],
              variations: [{ id: "v1", name: "Colour", options: [] }],
            },
          }),
        ])
      );
      mockGetByContextChildProducts.mockResolvedValue({ data: { data: [] } });

      await inSession(() => epGetProduct({ id: "shirt" }));

      expect(mockGetByContextChildProducts).toHaveBeenCalledWith(
        expect.objectContaining({ path: { product_id: PARENT_ID } })
      );
    });

    it.each([
      ["a comma", "a,b"],
      ["a parenthesis", "shirt)"],
      ["a space", "blue shirt"],
      ["a slash", "a/b"],
      ["only whitespace", "   "],
    ])("returns null without a request for a reference with %s", async (_, id) => {
      const result = await inSession(() => epGetProduct({ id }));

      expect(result).toBeNull();
      expect(mockGetByContextProduct).not.toHaveBeenCalled();
      expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
    });

    it("returns null rather than throwing when the read fails", async () => {
      mockGetByContextAllProducts.mockResolvedValue({
        data: undefined,
        error: { errors: [{ status: 500 }] },
        response: { status: 500 },
      });

      const result = await inSession(() => epGetProduct({ id: "blue-shirt" }));

      expect(result).toBeNull();
    });

    it("forwards the reference unchanged through the proxy in the browser", async () => {
      mockShouldUseProxy.mockReturnValue(true);
      mockCallEpProxy.mockResolvedValue(null);

      await epGetProduct({ id: "blue-shirt" });

      expect(mockCallEpProxy).toHaveBeenCalledWith(
        "getProduct",
        { id: "blue-shirt" },
        null
      );
      expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
    });
  });
});
