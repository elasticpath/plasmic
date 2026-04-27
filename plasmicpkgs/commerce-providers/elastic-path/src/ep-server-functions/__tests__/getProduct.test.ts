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

    const result = await epGetProduct({
      id: "test-product-id",
      auth: {
        accessToken: "token-abc",
        host: "https://api.test.elasticpath.com",
        clientId: "client-xyz",
      },
    });

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

  // When the caller's auth is undefined (typical in Studio canvas, where
  // $ctx.ep isn't populated by buildEpCtx), epGetProduct must fail-soft
  // and return null — NOT throw. The failure mode before this guard was
  // buildClient crashing on `auth.host` reading undefined, which blew up
  // the designer's query preview panel.
  it("returns null when auth is missing without calling EP", async () => {
    const result = await epGetProduct({
      id: "test-product-id",
      auth: undefined as any,
    });

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  // Same contract for a half-populated auth object — if either host,
  // clientId, or accessToken is missing, the SDK call would either
  // crash or send an unauthenticated request. Return null upstream so
  // the emptyContent slot renders instead.
  it("returns null when auth is missing required fields", async () => {
    const result = await epGetProduct({
      id: "test-product-id",
      auth: { host: "", clientId: "x", accessToken: "y" } as any,
    });

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  it("returns null when id is empty without calling EP", async () => {
    const result = await epGetProduct({
      id: "",
      auth: {
        accessToken: "token-abc",
        host: "https://api.test.elasticpath.com",
        clientId: "client-xyz",
      },
    });

    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  it("returns null when EP responds with no product data", async () => {
    mockGetByContextProduct.mockResolvedValue({ data: null });

    const result = await epGetProduct({
      id: "missing-id",
      auth: {
        accessToken: "token-abc",
        host: "https://api.test.elasticpath.com",
        clientId: "client-xyz",
      },
    });

    expect(result).toBeNull();
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

    const result = await epGetProduct({
      id: "child-id",
      auth: {
        accessToken: "token-abc",
        host: "https://api.test.elasticpath.com",
        clientId: "client-xyz",
      },
    });

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
