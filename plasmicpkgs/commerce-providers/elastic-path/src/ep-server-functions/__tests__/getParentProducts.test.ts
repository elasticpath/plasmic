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
const { epGetParentProducts } = require("../getParentProducts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const mkParent = (id: string) => ({
  id,
  attributes: { name: id, base_product: true },
  relationships: { children: { data: [{ id: `${id}-c1` }] } },
  meta: {
    variations: [
      { id: "v1", name: "Colour", options: [{ id: "o1", name: "Red" }] },
      { id: "", name: "dropped" },
    ],
    variation_matrix: { o1: `${id}-c1` },
  },
});

const mkChild = (id: string, excluded = false) => ({
  id,
  attributes: { name: id, sku: `SKU-${id}` },
  meta: {
    display_price: { without_tax: { formatted: "$5.00" } },
    ...(excluded ? { bundle_excluded: true } : {}),
  },
});

beforeEach(() => {
  mockGetByContextAllProducts.mockReset();
  mockGetByContextChildProducts.mockReset();
});

describe("epGetParentProducts", () => {
  it("reports parents with their variations and children", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkParent("p1")] },
    });
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [mkChild("p1-c1"), mkChild("p1-c2", true)] },
    });

    const result = await withEpSession(SESSION, () =>
      epGetParentProducts({ productIds: ["p1"] })
    );

    expect(result.p1.isParent).toBe(true);
    expect(result.p1.variations).toEqual([
      { id: "v1", name: "Colour", options: [{ id: "o1", name: "Red" }] },
    ]);
    expect(result.p1.variationMatrix).toEqual({ o1: "p1-c1" });
    expect(result.p1.children.map((c: any) => c.id)).toEqual([
      "p1-c1",
      "p1-c2",
    ]);
    expect(result.p1.children[1].excluded).toBe(true);
    expect(result.p1.error).toBeUndefined();
  });

  it("does not read children for a product that has none", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [{ id: "p1", attributes: { name: "p1" }, meta: {} }] },
    });

    const result = await withEpSession(SESSION, () =>
      epGetParentProducts({ productIds: ["p1"] })
    );

    expect(result.p1.isParent).toBe(false);
    expect(result.p1.children).toEqual([]);
    expect(mockGetByContextChildProducts).not.toHaveBeenCalled();
  });

  it("reports a product the catalog does not return", async () => {
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

    const result = await withEpSession(SESSION, () =>
      epGetParentProducts({ productIds: ["gone"] })
    );

    expect(result.gone).toEqual({
      id: "gone",
      isParent: false,
      children: [],
      variations: [],
      error: "Product gone not found",
    });
  });

  it("reports a child read failure as a serializable message", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkParent("p1")] },
    });
    mockGetByContextChildProducts.mockRejectedValue(new Error("boom"));

    const result = await withEpSession(SESSION, () =>
      epGetParentProducts({ productIds: ["p1"] })
    );

    expect(result.p1.error).toBe("boom");
    expect(result.p1.children).toEqual([]);
    // An `Error` flattens to `{}` through the proxy, so the message has to
    // be the thing that crosses.
    expect(JSON.parse(JSON.stringify(result)).p1.error).toBe("boom");
  });

  it("returns an empty map when called outside withEpSession", async () => {
    const result = await epGetParentProducts({ productIds: ["p1"] });
    expect(result).toEqual({});
    expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
  });
});
