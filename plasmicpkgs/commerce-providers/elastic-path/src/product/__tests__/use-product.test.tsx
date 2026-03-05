// @jest-environment jsdom
/**
 * Tests for use-product handler.fetcher.
 *
 * Why: The product fetcher handles three distinct paths — simple product,
 * parent with variations, and child product (variant URL visit). Incorrect
 * handling of child→parent resolution or variation matrix mapping causes
 * the wrong product to display or the variation picker to fail.
 */

/* ---------- mock variables ---------- */
const mockGetByContextProduct = jest.fn();
const mockGetByContextChildProducts = jest.fn();
const mockNormalizeProduct = jest.fn();
const mockGetEPClient = jest.fn().mockReturnValue("mock-client");
const mockHandleAPIError = jest
  .fn()
  .mockReturnValue({ message: "test error" });

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextProduct: (...a: unknown[]) => mockGetByContextProduct(...a),
  getByContextChildProducts: (...a: unknown[]) =>
    mockGetByContextChildProducts(...a),
}));

jest.mock("../../utils", () => ({
  normalizeProduct: (...a: unknown[]) => mockNormalizeProduct(...a),
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
  useProduct: jest.fn(),
}));

/* ---------- code under test ---------- */
const { handler } = require("../use-product") as typeof import("../use-product");

/* ---------- helpers ---------- */
const mockProvider = { locale: "en-US", client: "mock-client" };

function callFetcher(id?: string) {
  return handler.fetcher({
    input: { id },
    options: handler.fetchOptions,
    fetch: jest.fn(),
    provider: mockProvider,
  });
}

function makeProductResponse(id: string, meta: Record<string, any> = {}) {
  return {
    data: {
      data: {
        id,
        type: "product",
        attributes: { name: `Product ${id}`, slug: `product-${id}` },
        meta: {
          display_price: {
            without_tax: { amount: 1000, currency: "USD" },
          },
          ...meta,
        },
      },
    },
  };
}

/* ---------- tests ---------- */
describe("useProduct handler.fetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no id is provided", async () => {
    const result = await callFetcher(undefined);
    expect(result).toBeNull();
    expect(mockGetByContextProduct).not.toHaveBeenCalled();
  });

  it("fetches and normalizes a simple product", async () => {
    const productResp = makeProductResponse("prod-1");
    mockGetByContextProduct.mockResolvedValue(productResp);
    mockNormalizeProduct.mockReturnValue({
      id: "prod-1",
      name: "Product prod-1",
    });

    const result = await callFetcher("prod-1");

    expect(mockGetByContextProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        client: "mock-client",
        path: { product_id: "prod-1" },
        query: { include: ["main_image", "files", "component_products"] },
      })
    );
    expect(mockNormalizeProduct).toHaveBeenCalledWith(
      productResp.data,
      "en-US",
      undefined
    );
    expect(result).toEqual({ id: "prod-1", name: "Product prod-1" });
  });

  it("returns null when response has no data", async () => {
    mockGetByContextProduct.mockResolvedValue({ data: null });

    const result = await callFetcher("prod-1");
    expect(result).toBeNull();
  });

  it("fetches child products for parent with variations", async () => {
    const parentResp = makeProductResponse("parent-1", {
      variations: [
        { id: "v1", name: "Size", options: [{ id: "o1", name: "S" }] },
      ],
    });
    mockGetByContextProduct.mockResolvedValue(parentResp);

    const childResp = {
      data: {
        data: [
          {
            id: "child-1",
            attributes: { name: "Product - S", status: "live" },
          },
        ],
      },
    };
    mockGetByContextChildProducts.mockResolvedValue(childResp);
    mockNormalizeProduct.mockReturnValue({ id: "parent-1", variants: [] });

    await callFetcher("parent-1");

    expect(mockGetByContextChildProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { product_id: "parent-1" },
      })
    );
    expect(mockNormalizeProduct).toHaveBeenCalledWith(
      parentResp.data,
      "en-US",
      childResp.data
    );
  });

  it("fetches parent when child product is detected", async () => {
    // First call returns child product
    const childResp = makeProductResponse("child-1", {
      product_types: ["child"],
    });
    (childResp.data as any).data.attributes.base_product_id = "parent-1";

    // Second call returns parent product
    const parentResp = makeProductResponse("parent-1", {
      variations: [
        { id: "v1", name: "Size", options: [{ id: "o1", name: "S" }] },
      ],
    });

    mockGetByContextProduct
      .mockResolvedValueOnce(childResp)
      .mockResolvedValueOnce(parentResp);
    mockGetByContextChildProducts.mockResolvedValue({
      data: { data: [] },
    });
    mockNormalizeProduct.mockReturnValue({ id: "parent-1" });

    const result = await callFetcher("child-1");

    // Should have made two product calls
    expect(mockGetByContextProduct).toHaveBeenCalledTimes(2);

    // Second call should be for parent
    expect(mockGetByContextProduct).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: { product_id: "parent-1" },
      })
    );

    // Result should have __initialVariantId
    expect(result.__initialVariantId).toBe("child-1");
  });

  it("handles child product fetch failure gracefully", async () => {
    const parentResp = makeProductResponse("parent-1", {
      variations: [
        { id: "v1", name: "Size", options: [{ id: "o1", name: "S" }] },
      ],
    });
    mockGetByContextProduct.mockResolvedValue(parentResp);
    mockGetByContextChildProducts.mockRejectedValue(new Error("Network error"));
    mockNormalizeProduct.mockReturnValue({ id: "parent-1" });

    const result = await callFetcher("parent-1");

    // Should still return normalized product without child products
    expect(result).toEqual({ id: "parent-1" });
    expect(mockNormalizeProduct).toHaveBeenCalledWith(
      parentResp.data,
      "en-US",
      undefined
    );
  });

  it("returns null and logs error on API failure", async () => {
    mockGetByContextProduct.mockRejectedValue(new Error("API down"));

    const result = await callFetcher("prod-1");

    expect(result).toBeNull();
    expect(mockHandleAPIError).toHaveBeenCalled();
  });
});
