const mockGetStock = jest.fn();
const mockLocationList = jest.fn();
const mockUse = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: (...args: unknown[]) => mockUse(...args) } },
    },
  })),
  getStock: (...args: unknown[]) => mockGetStock(...args),
  listLocations: (...args: unknown[]) => mockLocationList(...args),
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

const mkLocations = (rows: Array<{ slug: string; name: string }>) => ({
  data: {
    data: rows.map(({ slug, name }) => ({
      id: `uuid-${slug}`,
      type: "inventory_location",
      attributes: { slug, name },
    })),
  },
});

beforeEach(() => {
  mockGetStock.mockReset();
  mockLocationList.mockReset();
  mockLocationList.mockResolvedValue(mkLocations([]));
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
    // The browser client's consumers read counts off `stock`, so the named
    // operation has to put them there too.
    expect(result.p1.locations[0].stock).toEqual({
      productId: "p1",
      available: 4,
      allocated: 1,
      total: 5,
    });
  });

  it("keeps the payload JSON-serializable", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({ "warehouse-a": { available: 4, allocated: 1, total: 5 } })
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"] })
    );

    // The result goes through the proxy route as JSON. In the SDK, these
    // counts have the type `BigInt`, and `JSON.stringify` throws an error on
    // a `BigInt`.
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("names each location from the locations list", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({
        "east-dc": { available: 4, allocated: 1, total: 5 },
        "main-warehouse": { available: 2, allocated: 0, total: 2 },
      })
    );
    mockLocationList.mockResolvedValue(
      mkLocations([
        { slug: "east-dc", name: "East Distribution Centre" },
        { slug: "main-warehouse", name: "Main Warehouse" },
      ])
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"] })
    );

    expect(result.p1.locations.map((l: any) => l.location.attributes)).toEqual([
      { name: "East Distribution Centre", slug: "east-dc" },
      { name: "Main Warehouse", slug: "main-warehouse" },
    ]);
    expect(result.p1.locations[0].location.id).toBe("east-dc");
  });

  it("reads the locations list once for several products", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({ "east-dc": { available: 4, allocated: 1, total: 5 } })
    );
    mockLocationList.mockResolvedValue(
      mkLocations([{ slug: "east-dc", name: "East Distribution Centre" }])
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1", "p2"] })
    );

    expect(mockLocationList).toHaveBeenCalledTimes(1);
    expect(result.p2.locations[0].location.attributes.name).toBe(
      "East Distribution Centre"
    );
  });

  it("names a location from a later page of the locations list", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({ "east-dc": { available: 4, allocated: 1, total: 5 } })
    );
    mockLocationList
      .mockResolvedValueOnce(
        mkLocations(
          Array.from({ length: 100 }, (_, i) => ({
            slug: `loc-${i}`,
            name: `Location ${i}`,
          }))
        )
      )
      .mockResolvedValueOnce(
        mkLocations([{ slug: "east-dc", name: "East Distribution Centre" }])
      );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"] })
    );

    expect(result.p1.locations[0].location.attributes.name).toBe(
      "East Distribution Centre"
    );
  });

  it("keeps the slug as the name of a location the list does not carry", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({
        "east-dc": { available: 4, allocated: 1, total: 5 },
        "pop-up": { available: 1, allocated: 0, total: 1 },
      })
    );
    mockLocationList.mockResolvedValue(
      mkLocations([{ slug: "east-dc", name: "East Distribution Centre" }])
    );

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"] })
    );

    expect(
      result.p1.locations.map((l: any) => l.location.attributes.name)
    ).toEqual(["East Distribution Centre", "pop-up"]);
  });

  it("keeps the stock when the locations read fails", async () => {
    mockGetStock.mockResolvedValue(
      mkStock({ "east-dc": { available: 4, allocated: 1, total: 5 } })
    );
    mockLocationList.mockRejectedValue(new Error("boom"));

    const result = await withEpSession(SESSION, () =>
      epGetStock({ productIds: ["p1"] })
    );

    expect(result.p1.totalAvailable).toBe(4);
    expect(result.p1.locations[0].location.attributes).toEqual({
      name: "east-dc",
      slug: "east-dc",
    });
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
    expect(mockLocationList).not.toHaveBeenCalled();
  });

  it("returns an empty map when called outside withEpSession", async () => {
    const result = await epGetStock({ productIds: ["p1"] });
    expect(result).toEqual({});
    expect(mockGetStock).not.toHaveBeenCalled();
    expect(mockLocationList).not.toHaveBeenCalled();
  });
});
