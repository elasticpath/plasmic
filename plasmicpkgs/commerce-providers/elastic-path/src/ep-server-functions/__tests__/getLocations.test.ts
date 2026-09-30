const mockListLocations = jest.fn();
const mockUse = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: (...args: unknown[]) => mockUse(...args) } },
    },
  })),
  listLocations: (...args: unknown[]) => mockListLocations(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetLocations } = require("../getLocations");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const page = (count: number, from = 0) => ({
  data: {
    data: Array.from({ length: count }, (_, i) => ({
      id: `l${from + i}`,
      type: "location",
      attributes: { name: `Location ${from + i}`, slug: `loc-${from + i}` },
    })),
  },
});

beforeEach(() => {
  mockListLocations.mockReset();
  mockUse.mockReset();
});

describe("epGetLocations", () => {
  it("returns the locations Elastic Path lists", async () => {
    mockListLocations.mockResolvedValue({
      data: {
        data: [
          { id: "l1", type: "location", attributes: { name: "A", slug: "a" } },
          { id: "l2", type: "location", attributes: { name: "B", slug: "b" } },
        ],
      },
    });

    const result = await withEpSession(SESSION, () => epGetLocations());

    expect(result.map((l: any) => l.id)).toEqual(["l1", "l2"]);
    expect(mockListLocations).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { "page[limit]": 100, "page[offset]": 0 },
      })
    );
  });

  it("filters by location type when one is given", async () => {
    mockListLocations.mockResolvedValue({ data: { data: [] } });

    await withEpSession(SESSION, () => epGetLocations({ type: "warehouse" }));

    expect(mockListLocations).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          filter: "eq(type,warehouse)",
          "page[limit]": 100,
          "page[offset]": 0,
        },
      })
    );
  });

  it("reads every page of the list", async () => {
    mockListLocations
      .mockResolvedValueOnce(page(100))
      .mockResolvedValueOnce(page(3, 100));

    const result = await withEpSession(SESSION, () =>
      epGetLocations({ type: "warehouse" })
    );

    expect(result).toHaveLength(103);
    expect(result[102].attributes.slug).toBe("loc-102");
    expect(mockListLocations.mock.calls.map(([arg]) => arg.query)).toEqual([
      { filter: "eq(type,warehouse)", "page[limit]": 100, "page[offset]": 0 },
      { filter: "eq(type,warehouse)", "page[limit]": 100, "page[offset]": 100 },
    ]);
  });

  it("keeps the pages already read when a later page fails", async () => {
    mockListLocations
      .mockResolvedValueOnce(page(100))
      .mockRejectedValueOnce(new Error("boom"));

    const result = await withEpSession(SESSION, () => epGetLocations());

    expect(result).toHaveLength(100);
  });

  it("stops at the furthest offset Elastic Path allows", async () => {
    mockListLocations.mockImplementation(() => Promise.resolve(page(100)));

    await withEpSession(SESSION, () => epGetLocations());

    expect(mockListLocations).toHaveBeenCalledTimes(101);
    expect(mockListLocations.mock.calls[100][0].query["page[offset]"]).toBe(
      10_000
    );
  });

  it("asks for multi-location inventory, which the endpoint 404s without", async () => {
    mockListLocations.mockResolvedValue({ data: { data: [] } });

    await withEpSession(SESSION, () => epGetLocations());

    const headers = new Headers();
    for (const [interceptor] of mockUse.mock.calls) {
      await interceptor({ headers } as unknown as Request);
    }
    expect(headers.get("EP-Inventories-Multi-Location")).toBe("true");
  });

  it("returns an empty array when the read fails", async () => {
    mockListLocations.mockRejectedValue(new Error("boom"));

    const result = await withEpSession(SESSION, () => epGetLocations());
    expect(result).toEqual([]);
  });

  it("returns an empty array when called outside withEpSession", async () => {
    const result = await epGetLocations();
    expect(result).toEqual([]);
    expect(mockListLocations).not.toHaveBeenCalled();
  });
});
