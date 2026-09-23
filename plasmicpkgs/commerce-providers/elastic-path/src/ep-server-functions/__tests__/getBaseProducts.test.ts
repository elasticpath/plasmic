const mockGetByContextAllProducts = jest.fn();
const mockGetByContextChildProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  getByContextAllProducts: (...args: unknown[]) =>
    mockGetByContextAllProducts(...args),
  getByContextChildProducts: (...args: unknown[]) =>
    mockGetByContextChildProducts(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetBaseProducts } = require("../getBaseProducts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const mkBase = (id: string) => ({
  id,
  type: "product",
  attributes: { name: id, base_product: true },
  relationships: { children: { data: [{ id: `${id}-c1` }] } },
  meta: {
    variations: [
      {
        id: "v1",
        name: "Colour",
        sort_order: 1,
        options: [{ id: "o1", name: "Red", sort_order: 1 }],
      },
    ],
    variation_matrix: { o1: `${id}-c1` },
    product_types: [],
  },
});

const mkChild = (id: string, bundleExcluded = false) => ({
  id,
  type: "product",
  attributes: { name: id, sku: `SKU-${id}` },
  meta: {
    display_price: {
      without_tax: { amount: 500, currency: "USD", formatted: "$5.00" },
    },
    ...(bundleExcluded ? { bundle_excluded: true } : {}),
  },
});

beforeEach(() => {
  mockGetByContextAllProducts.mockReset();
  mockGetByContextChildProducts.mockReset();
});

describe("epGetBaseProducts", () => {
  it("returns a base product with its variations and child products", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkBase("p1")] },
    });
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [mkChild("p1-c1"), mkChild("p1-c2", true)] },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBaseProducts({ productIds: ["p1"] })
    );

    expect(result.p1.variations).toEqual([
      {
        id: "v1",
        name: "Colour",
        sortOrder: 1,
        options: [
          { id: "o1", name: "Red", description: undefined, sortOrder: 1 },
        ],
      },
    ]);
    expect(result.p1.childProducts.map((c: any) => c.id)).toEqual([
      "p1-c1",
      "p1-c2",
    ]);
    expect(result.p1.childProducts[0].sku).toBe("SKU-p1-c1");
  });

  it("publishes each child's price with all four members", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkBase("p1")] },
    });
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [mkChild("p1-c1")] },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBaseProducts({ productIds: ["p1"] })
    );

    expect(result.p1.childProducts[0].price).toEqual({
      amount: 500,
      currency: "USD",
      formatted: "$5.00",
      float_price: 5,
    });
  });

  it("carries the merchandiser's bundle exclusion through to the child", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkBase("p1")] },
    });
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [mkChild("p1-c1"), mkChild("p1-c2", true)] },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBaseProducts({ productIds: ["p1"] })
    );

    expect(result.p1.childProducts[0].bundleExcluded).toBeUndefined();
    expect(result.p1.childProducts[1].bundleExcluded).toBe(true);
  });

  it("does not read children for a product that is not a base product", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: {
        data: [{ id: "p1", type: "product", attributes: { name: "p1" }, meta: {} }],
      },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBaseProducts({ productIds: ["p1"] })
    );

    expect(result.p1.childProducts).toEqual([]);
    expect(mockGetByContextChildProducts).not.toHaveBeenCalled();
  });

  it("omits a product the catalog does not return", async () => {
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

    const result = await withEpSession(SESSION, () =>
      epGetBaseProducts({ productIds: ["gone"] })
    );

    expect(result).toEqual({});
  });

  it("still returns the base product when its children are unreadable", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkBase("p1")] },
    });
    mockGetByContextChildProducts.mockRejectedValue(new Error("boom"));

    const result = await withEpSession(SESSION, () =>
      epGetBaseProducts({ productIds: ["p1"] })
    );

    expect(result.p1.childProducts).toEqual([]);
    expect(result.p1.variations).toHaveLength(1);
  });

  it("keeps the payload JSON-serializable", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkBase("p1")] },
    });
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [mkChild("p1-c1")] },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBaseProducts({ productIds: ["p1"] })
    );

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("returns an empty map when called outside withEpSession", async () => {
    const result = await epGetBaseProducts({ productIds: ["p1"] });
    expect(result).toEqual({});
    expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
  });
});
