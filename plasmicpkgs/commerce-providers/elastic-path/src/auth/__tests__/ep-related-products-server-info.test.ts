import {
  epRelatedProductsGetServerInfo,
  fetchRelatedProductsForServer,
} from "../ep-related-products-server-info";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

const mockProducts = {
  data: [{ id: "r1" }, { id: "r2" }],
};

describe("fetchRelatedProductsForServer", () => {
  it("fetches products from EP catalog API", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProducts),
    });

    const result = await fetchRelatedProductsForServer(
      "prod-123",
      "server-token",
      "https://useast.api.elasticpath.com",
      4
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/catalog/products");
    expect(opts.headers["Authorization"]).toBe("Bearer server-token");
    expect(result).toEqual(mockProducts);
  });
});

describe("epRelatedProductsGetServerInfo", () => {
  it("returns providedData when serverToken and productId available", () => {
    const mockOps = {
      readContext: jest.fn((key: string) => {
        if (key === "ep-server-token") return "token-abc";
        if (key === "ep-host") return "https://useast.api.elasticpath.com";
        return undefined;
      }),
      readDataEnv: jest.fn(),
      readDataSelector: jest.fn(),
      readDataSelectors: jest.fn(),
      fetchData: jest.fn().mockReturnValue(mockProducts),
    };

    const result = epRelatedProductsGetServerInfo(
      { productId: "prod-123", maxProducts: 4 },
      mockOps
    );

    expect(mockOps.fetchData).toHaveBeenCalled();
    expect(result.providedData).toEqual([
      { name: "epRelatedProducts", data: mockProducts },
    ]);
  });

  it("returns empty when no serverToken", () => {
    const mockOps = {
      readContext: jest.fn().mockReturnValue(undefined),
      readDataEnv: jest.fn(),
      readDataSelector: jest.fn(),
      readDataSelectors: jest.fn(),
      fetchData: jest.fn(),
    };

    const result = epRelatedProductsGetServerInfo(
      { productId: "prod-123" },
      mockOps
    );
    expect(result).toEqual({});
  });

  it("returns empty when no productId", () => {
    const mockOps = {
      readContext: jest.fn().mockReturnValue("token"),
      readDataEnv: jest.fn(),
      readDataSelector: jest.fn(),
      readDataSelectors: jest.fn(),
      fetchData: jest.fn(),
    };

    const result = epRelatedProductsGetServerInfo({}, mockOps);
    expect(result).toEqual({});
  });
});
