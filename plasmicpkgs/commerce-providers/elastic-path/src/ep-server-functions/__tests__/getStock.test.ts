const mockGetStock = jest.fn();
const mockUse = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: (...args: unknown[]) => mockUse(...args) } },
    },
  })),
  getStock: (...args: unknown[]) => mockGetStock(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetStock } = require("../getStock");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const mkStock = (
  locations: Record<string, { available: number; allocated: number; total: number }>
) => ({ data: { data: { attributes: { locations } } } });

beforeEach(() => {
  mockGetStock.mockReset();
  mockUse.mockReset();
});

describe("epGetStock", () => {
  it("returns per-location stock keyed by product id", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({
        "warehouse-a": { available: 4, allocated: 1, total: 5 },
        "store-b": { available: 2, allocated: 0, total: 2 },
      })
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"] })
    );

    expect(Object.keys(result)).toEqual(["p1"]);
    expect(result.p1.totalAvailable).toBe(6);
    expect(result.p1.totalAllocated).toBe(1);
    expect(result.p1.totalStock).toBe(7);
    expect(result.p1.locations.map((l: any) => l.location.id)).toEqual([
      "warehouse-a",
      "store-b",
    ]);
  });

  it("keeps the payload JSON-serializable", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({ "warehouse-a": { available: 4, allocated: 1, total: 5 } })
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"] })
    );

    // The result crosses the proxy route as JSON. The browser hook builds
    // these counts as BigInt, which `JSON.stringify` throws on.
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("narrows to the requested locations", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({
        "warehouse-a": { available: 4, allocated: 1, total: 5 },
        "store-b": { available: 2, allocated: 0, total: 2 },
      })
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"], locationIds: ["store-b"] })
    );

    expect(result.p1.locations).toHaveLength(1);
    expect(result.p1.totalAvailable).toBe(2);
  });

  it("asks Elastic Path for multi-location inventory", async () => {
    mockGetStock.mockResolvedValue(mkStock({}));

    await withEpSession(SESSION, () => epGetStock({ productIds: ["p1"] }));

    const headers = new Headers();
    for (const [interceptor] of mockUse.mock.calls) {
      await interceptor({ headers } as unknown as Request);
    }
    expect(headers.get("EP-Inventories-Multi-Location")).toBe("true");
  });

  it("returns an empty entry for a product whose stock read fails", async () => {
    mockGetStock.mockImplementation(({ path }: any) =>
      path.product_uuid === "p1"
        ? Promise.resolve(
            mkStock({ "warehouse-a": { available: 4, allocated: 1, total: 5 } })
          )
        : Promise.reject(new Error("boom"))
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1", "p2"] })
    );

    expect(result.p1.totalAvailable).toBe(4);
    expect(result.p2).toEqual({
      productId: "p2",
      locations: [],
      totalStock: 0,
      totalAllocated: 0,
      totalAvailable: 0,
    });
  });

  it("returns an empty map for no product ids", async () => {
    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: [] })
    );
    expect(result).toEqual({});
    expect(mockGetStock).not.toHaveBeenCalled();
  });

  it("returns an empty map when called outside withEpSession", async () => {
    const result = await epGetStock({ productIds: ["p1"] });
    expect(result).toEqual({});
    expect(mockGetStock).not.toHaveBeenCalled();
  });
});
