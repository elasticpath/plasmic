import {
  epProductGetServerInfo,
  fetchProductForServer,
} from "../ep-product-server-info";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

const mockProduct = {
  data: {
    id: "prod-123",
    attributes: { name: "Test Product", sku: "SKU-1" },
  },
  included: { main_images: [{ id: "img-1" }] },
};

describe("fetchProductForServer", () => {
  it("fetches a product from EP API using server token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProduct),
    });

    const result = await fetchProductForServer(
      "prod-123",
      "server-token-abc",
      "https://useast.api.elasticpath.com"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/catalog/products/prod-123");
    expect(url).toContain("include=main_image");
    expect(opts.headers["Authorization"]).toBe("Bearer server-token-abc");
    expect(result).toEqual(mockProduct);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    });

    await expect(
      fetchProductForServer("bad-id", "token", "https://useast.api.elasticpath.com")
    ).rejects.toThrow();
  });
});

describe("epProductGetServerInfo", () => {
  it("returns providedData with product when serverToken and productId available", () => {
    const mockOps = {
      readContext: jest.fn().mockReturnValue("server-token-abc"),
      readDataEnv: jest.fn(),
      readDataSelector: jest.fn(),
      readDataSelectors: jest.fn(),
      fetchData: jest.fn().mockReturnValue(mockProduct),
    };

    const result = epProductGetServerInfo(
      { productId: "prod-123" },
      mockOps
    );

    expect(mockOps.readContext).toHaveBeenCalledWith("ep-server-token");
    expect(mockOps.fetchData).toHaveBeenCalledWith(
      ["ep-product", "prod-123"],
      expect.any(Function)
    );
    expect(result.providedData).toEqual([
      { name: "epProduct", data: mockProduct },
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

    const result = epProductGetServerInfo(
      { productId: "prod-123" },
      mockOps
    );

    expect(result).toEqual({});
    expect(mockOps.fetchData).not.toHaveBeenCalled();
  });

  it("returns empty when no productId", () => {
    const mockOps = {
      readContext: jest.fn().mockReturnValue("server-token-abc"),
      readDataEnv: jest.fn(),
      readDataSelector: jest.fn(),
      readDataSelectors: jest.fn(),
      fetchData: jest.fn(),
    };

    const result = epProductGetServerInfo({}, mockOps);

    expect(result).toEqual({});
    expect(mockOps.fetchData).not.toHaveBeenCalled();
  });
});
