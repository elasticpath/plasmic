// NOTE: esbuild hoists ES `import` to require() at the top, BEFORE jest.mock
// calls (same trick as src/bundle/__tests__/use-parent-products.test.tsx).
// Declare mocks up here so the factory references stable module-scope vars,
// then require() the code under test so it loads AFTER mocks are registered.

const mockGetByContextProduct = jest.fn();
const mockGetByContextChildProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  getByContextProduct: (...args: unknown[]) =>
    mockGetByContextProduct(...args),
  getByContextChildProducts: (...args: unknown[]) =>
    mockGetByContextChildProducts(...args),
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

beforeEach(() => {
  mockGetByContextProduct.mockReset();
  mockGetByContextChildProducts.mockReset();
});

describe("epGetProduct", () => {
  it("returns a normalized product when EP returns a standalone product", async () => {
    mockGetByContextProduct.mockResolvedValue({
      data: {
        data: {
          id: "test-product-id",
          type: "product",
          attributes: {
            name: "Test Product",
            slug: "test-product",
            sku: "TEST-SKU",
            description: "A lovely product",
          },
          meta: {
            display_price: {
              without_tax: {
                amount: 1500,
                currency: "USD",
                formatted: "$15.00",
              },
            },
            product_types: [],
          },
        },
        included: {},
      },
    });

    const result = await withEpSession(TEST_SESSION, () =>
      epGetProduct({ id: "test-product-id" })
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe("test-product-id");
    expect(result?.name).toBe("Test Product");
    expect(mockGetByContextProduct).toHaveBeenCalledTimes(1);
    expect(mockGetByContextProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { product_id: "test-product-id" },
      })
    );
  });

  // When called outside any withEpSession scope (typical in Studio canvas,
  // where the loader runs in the browser without ALS), epGetProduct must
  // fail-soft and return null — NOT throw. Designers see an empty preview
  // instead of a crashed query panel.
  it("returns null when called outside withEpSession", async () => {
    const result = await epGetProduct({ id: "test-product-id" });

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  // Same contract when the ALS session is half-populated — host,
  // clientId, or accessToken missing. Return null upstream so the
  // emptyContent slot renders instead of an unauthenticated SDK call.
  it("returns null when ALS session is missing required fields", async () => {
    const result = await withEpSession(
      { host: "", clientId: "x", accessToken: "y" } as any,
      () => epGetProduct({ id: "test-product-id" })
    );

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  it("returns null when id is empty without calling EP", async () => {
    const result = await withEpSession(TEST_SESSION, () =>
      epGetProduct({ id: "" })
    );

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  it("returns null when EP responds with no product data", async () => {
    mockGetByContextProduct.mockResolvedValue({ data: null });

    const result = await withEpSession(TEST_SESSION, () =>
      epGetProduct({ id: "missing-id" })
    );

    expect(result).toBeNull();
  });

  // Studio canvas + the data-query "Execute" panel call the function
  // outside any withEpSession scope. To keep designer-side testability,
  // the function falls back to `input.auth` when ALS has no session.
  // SSR consumers never set `auth` in Studio bindings, so this fallback
  // doesn't affect the SSR cache key.
  it("falls back to input.auth when no ALS session is active", async () => {
    mockGetByContextProduct.mockResolvedValue({
      data: {
        data: {
          id: "canvas-product",
          type: "product",
          attributes: { name: "Canvas Product", slug: "canvas-product" },
          meta: {
            display_price: {
              without_tax: { amount: 999, currency: "USD" },
            },
            product_types: [],
          },
        },
        included: {},
      },
    });

    // No withEpSession wrap — passes auth via input instead.
    const result = await epGetProduct({
      id: "canvas-product",
      auth: TEST_SESSION as any,
    } as any);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("canvas-product");
  });

  it("prefers ALS session over input.auth when both are present", async () => {
    mockGetByContextProduct.mockResolvedValue({
      data: {
        data: {
          id: "test-product-id",
          type: "product",
          attributes: { name: "From ALS", slug: "p" },
          meta: {
            display_price: { without_tax: { amount: 1, currency: "USD" } },
            product_types: [],
          },
        },
        included: {},
      },
    });

    // Both ALS and input.auth set — ALS wins (so cache-key parity holds in SSR).
    const result = await withEpSession(TEST_SESSION, () =>
      epGetProduct({
        id: "test-product-id",
        auth: { ...TEST_SESSION, accessToken: "FROM_INPUT" } as any,
      } as any)
    );

    expect(result).not.toBeNull();
    expect(result?.name).toBe("From ALS");
  });

  it("fetches parent and attaches __initialVariantId when id points at a child variant", async () => {
    const childResponse = {
      data: {
        data: {
          id: "child-id",
          type: "product",
          attributes: {
            name: "Child Variant",
            base_product_id: "parent-id",
          },
          meta: {
            product_types: ["child"],
            display_price: { without_tax: { amount: 2000, currency: "USD" } },
          },
        },
        included: {},
      },
    };
    const parentResponse = {
      data: {
        data: {
          id: "parent-id",
          type: "product",
          attributes: { name: "Parent Product" },
          meta: {
            product_types: ["parent"],
            display_price: { without_tax: { amount: 2000, currency: "USD" } },
          },
        },
        included: {},
      },
    };

    mockGetByContextProduct
      .mockResolvedValueOnce(childResponse)
      .mockResolvedValueOnce(parentResponse);

    const result = await withEpSession(TEST_SESSION, () =>
      epGetProduct({ id: "child-id" })
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe("parent-id");
    expect(result?.name).toBe("Parent Product");
    expect((result as { __initialVariantId?: string }).__initialVariantId).toBe(
      "child-id"
    );
    expect(mockGetByContextProduct).toHaveBeenCalledTimes(2);
    expect(mockGetByContextProduct).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: { product_id: "parent-id" } })
    );
  });
});
