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
      expect.objectContaining({ query: {} })
    );
  });

  it("filters by location type when one is given", async () => {
    mockListLocations.mockResolvedValue({ data: { data: [] } });

    await withEpSession(SESSION, () => epGetLocations({ type: "warehouse" }));

    expect(mockListLocations).toHaveBeenCalledWith(
      expect.objectContaining({ query: { filter: "eq(type,warehouse)" } })
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
