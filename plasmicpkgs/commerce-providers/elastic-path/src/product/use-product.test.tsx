/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";

const mockUseMutablePlasmicQueryData = jest.fn();
jest.mock("@plasmicapp/query", () => ({
  useMutablePlasmicQueryData: (...a: unknown[]) =>
    mockUseMutablePlasmicQueryData(...a),
}));

const mockGetByContextProduct = jest.fn();
const mockGetByContextAllProducts = jest.fn();
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextProduct: (...a: unknown[]) => mockGetByContextProduct(...a),
  getByContextAllProducts: (...a: unknown[]) =>
    mockGetByContextAllProducts(...a),
  getByContextChildProducts: jest.fn(),
}));

const mockUseEpCommerce = jest.fn();
jest.mock("../shopper-context/EpCommerceContext", () => ({
  useEpCommerce: (...a: unknown[]) => mockUseEpCommerce(...a),
}));

jest.mock("../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const useProduct = require("./use-product").default as typeof import("./use-product").default;

const mockClient = { baseUrl: "https://api.test.com" };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseEpCommerce.mockReturnValue({
    client: mockClient,
    locale: "en-US",
    currencyDisplay: "symbol",
  });
  mockUseMutablePlasmicQueryData.mockReturnValue({
    data: undefined,
    error: undefined,
    isLoading: false,
    mutate: jest.fn(),
  });
});

describe("useProduct", () => {
  it("keys the query on the product id", () => {
    renderHook(() => useProduct({ id: "prod-1" }));

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      ["ep-product", "prod-1"],
      expect.any(Function),
      expect.objectContaining({ revalidateOnFocus: false })
    );
  });

  it("passes a null key when no id is given, so no fetch runs", () => {
    renderHook(() => useProduct({}));

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.any(Object)
    );
  });

  it("passes a null key when no provider is configured", () => {
    mockUseEpCommerce.mockReturnValue(null);

    renderHook(() => useProduct({ id: "prod-1" }));

    expect(mockUseMutablePlasmicQueryData).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.any(Object)
    );
  });

  // The query hook reports a null key as loading forever: no data, no error.
  it.each([
    ["no reference is given", {}, true],
    ["no provider is configured", { id: "prod-1" }, false],
  ])("reports not loading when %s", (_, input, withProvider) => {
    if (!withProvider) mockUseEpCommerce.mockReturnValue(null);
    mockUseMutablePlasmicQueryData.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });

    const { result } = renderHook(() => useProduct(input));

    expect(result.current.isLoading).toBe(false);
  });

  describe("fetcher", () => {
    // The hook hands its fetcher to SWR; run the one it registered.
    function runFetcher(id: string) {
      renderHook(() => useProduct({ id }));
      const fetcher = mockUseMutablePlasmicQueryData.mock.calls[0][1];
      return fetcher();
    }

    it("resolves a slug to the product it names", async () => {
      mockGetByContextAllProducts.mockResolvedValue({
        data: { data: [{ id: "prod-1", attributes: { slug: "blue-shirt" } }] },
      });

      const product = await runFetcher("blue-shirt");

      expect(product?.id).toBe("prod-1");
    });

    it("returns null when the reference names no product", async () => {
      mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

      await expect(runFetcher("gone")).resolves.toBeNull();
    });

    it("rejects when the read fails, so SWR reports an error", async () => {
      mockGetByContextAllProducts.mockResolvedValue({
        error: { errors: [] },
        response: { status: 503 },
      });

      await expect(runFetcher("blue-shirt")).rejects.toThrow();
    });

    it("rejects when the request itself throws", async () => {
      mockGetByContextAllProducts.mockRejectedValue(new TypeError("offline"));

      await expect(runFetcher("blue-shirt")).rejects.toThrow("offline");
    });
  });
});
