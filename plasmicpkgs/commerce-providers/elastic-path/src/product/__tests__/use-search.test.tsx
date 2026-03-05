// @jest-environment jsdom
/**
 * Tests for use-search handler.fetcher.
 *
 * Why: The search fetcher translates user-facing filters (search term, category,
 * sort order, pagination) into EP API query parameters. Incorrect parameter
 * mapping causes wrong products to appear or empty results. Error handling
 * must return an empty array (not throw) to prevent React from crashing the
 * entire product listing page.
 */

/* ---------- mock variables ---------- */
const mockGetByContextAllProducts = jest.fn();
const mockNormalizeProductFromList = jest.fn();
const mockGetSortVariables = jest.fn();
const mockGetEPClient = jest.fn().mockReturnValue("mock-client");
const mockHandleAPIError = jest
  .fn()
  .mockReturnValue({ message: "test error" });

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextAllProducts: (...a: unknown[]) =>
    mockGetByContextAllProducts(...a),
}));

jest.mock("../../utils", () => ({
  normalizeProductFromList: (...a: unknown[]) =>
    mockNormalizeProductFromList(...a),
  getSortVariables: (...a: unknown[]) => mockGetSortVariables(...a),
}));

jest.mock("../../utils/getEPClient", () => ({
  getEPClient: (...a: unknown[]) => mockGetEPClient(...a),
}));

jest.mock("../../utils/errorHandling", () => ({
  handleAPIError: (...a: unknown[]) => mockHandleAPIError(...a),
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock("@plasmicpkgs/commerce", () => ({
  useSearch: jest.fn(),
}));

/* ---------- code under test ---------- */
const { handler } = require("../use-search") as typeof import("../use-search");

/* ---------- helpers ---------- */
const mockProvider = { locale: "en-US", client: "mock-client" };

function callFetcher(input: Record<string, any> = {}) {
  return handler.fetcher({
    input,
    options: handler.fetchOptions,
    fetch: jest.fn(),
    provider: mockProvider,
  });
}

function makeListResponse(
  products: Array<{ id: string; name: string }>,
  included: any = {}
) {
  return {
    data: {
      data: products.map((p) => ({
        id: p.id,
        type: "product",
        attributes: { name: p.name, slug: p.name.toLowerCase() },
      })),
      included,
    },
  };
}

/* ---------- tests ---------- */
describe("useSearch handler.fetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNormalizeProductFromList.mockImplementation((product: any) => ({
      id: product.id,
      name: product.attributes?.name,
    }));
  });

  it("fetches all products with default parameters", async () => {
    const resp = makeListResponse([
      { id: "p1", name: "Shirt" },
      { id: "p2", name: "Pants" },
    ]);
    mockGetByContextAllProducts.mockResolvedValue(resp);

    const result = await callFetcher();

    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        client: "mock-client",
        query: expect.objectContaining({
          include: ["main_image", "files", "component_products"],
        }),
      })
    );
    expect(result.products).toHaveLength(2);
    expect(result.found).toBe(true);
  });

  it("applies search filter", async () => {
    const resp = makeListResponse([{ id: "p1", name: "Shirt" }]);
    mockGetByContextAllProducts.mockResolvedValue(resp);

    await callFetcher({ search: "Shirt" });

    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          filter: "eq(name,Shirt)",
        }),
      })
    );
  });

  it("applies pagination limit", async () => {
    const resp = makeListResponse([{ id: "p1", name: "A" }]);
    mockGetByContextAllProducts.mockResolvedValue(resp);

    await callFetcher({ count: 10 });

    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          "page[limit]": 10,
        }),
      })
    );
  });

  it("applies sort variable", async () => {
    const resp = makeListResponse([{ id: "p1", name: "A" }]);
    mockGetByContextAllProducts.mockResolvedValue(resp);
    mockGetSortVariables.mockReturnValue("price asc");

    await callFetcher({ sort: "price-asc" });

    expect(mockGetSortVariables).toHaveBeenCalledWith("price-asc");
    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          sort: "price asc",
        }),
      })
    );
  });

  it("does not add sort when getSortVariables returns undefined", async () => {
    const resp = makeListResponse([{ id: "p1", name: "A" }]);
    mockGetByContextAllProducts.mockResolvedValue(resp);
    mockGetSortVariables.mockReturnValue(undefined);

    await callFetcher({ sort: "trending-desc" });

    const callArgs = mockGetByContextAllProducts.mock.calls[0][0];
    expect(callArgs.query.sort).toBeUndefined();
  });

  it("returns empty products when response has no data", async () => {
    mockGetByContextAllProducts.mockResolvedValue({ data: null });

    const result = await callFetcher();

    expect(result.products).toEqual([]);
    expect(result.found).toBe(false);
  });

  it("passes included data to normalizeProductFromList", async () => {
    const included = {
      main_images: [{ id: "img-1", link: { href: "https://example.com/a.jpg" } }],
    };
    const resp = makeListResponse([{ id: "p1", name: "A" }], included);
    mockGetByContextAllProducts.mockResolvedValue(resp);

    await callFetcher();

    expect(mockNormalizeProductFromList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
      "en-US",
      included
    );
  });

  it("returns empty array on API error", async () => {
    mockGetByContextAllProducts.mockRejectedValue(new Error("API down"));

    const result = await callFetcher();

    expect(result.products).toEqual([]);
    expect(result.found).toBe(false);
    expect(mockHandleAPIError).toHaveBeenCalled();
  });

  it("applies category filter", async () => {
    const resp = makeListResponse([{ id: "p1", name: "A" }]);
    mockGetByContextAllProducts.mockResolvedValue(resp);

    await callFetcher({ categoryId: 42 });

    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          filter: "category.id=42",
        }),
      })
    );
  });

  it("combines search and category filters", async () => {
    const resp = makeListResponse([{ id: "p1", name: "A" }]);
    mockGetByContextAllProducts.mockResolvedValue(resp);

    await callFetcher({ search: "Shirt", categoryId: 5 });

    const callArgs = mockGetByContextAllProducts.mock.calls[0][0];
    expect(callArgs.query.filter).toContain("eq(name,Shirt)");
    expect(callArgs.query.filter).toContain("category.id=5");
  });
});
