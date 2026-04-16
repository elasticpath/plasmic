import {
  epProductListGetServerInfo,
  fetchProductListForServer,
} from "../ep-product-list-server-info";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

const mockProducts = {
  data: [{ id: "p1" }, { id: "p2" }],
  meta: { results: { total: 2 } },
};

describe("fetchProductListForServer", () => {
  it("fetches products with pagination params", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProducts),
    });

    const result = await fetchProductListForServer(
      "server-token",
      "https://useast.api.elasticpath.com",
      { page: 0, pageSize: 12 }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/catalog/products");
    expect(url).toContain("page%5Blimit%5D=12");
    expect(url).toContain("page%5Boffset%5D=0");
    expect(opts.headers["Authorization"]).toBe("Bearer server-token");
    expect(result).toEqual(mockProducts);
  });

  it("includes category filter when provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProducts),
    });

    await fetchProductListForServer(
      "server-token",
      "https://useast.api.elasticpath.com",
      { page: 0, pageSize: 12, categoryId: "cat-1" }
    );

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("filter=eq%28category.id%2Ccat-1%29");
  });
});

describe("epProductListGetServerInfo", () => {
  it("returns providedData when serverToken available", () => {
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

    const result = epProductListGetServerInfo(
      { pageSize: 12 },
      mockOps
    );

    expect(mockOps.fetchData).toHaveBeenCalled();
    expect(result.providedData).toEqual([
      { name: "epProductList", data: mockProducts },
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

    const result = epProductListGetServerInfo({ pageSize: 12 }, mockOps);
    expect(result).toEqual({});
  });
});
