/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";

const mockUseMutablePlasmicQueryData = jest.fn();
jest.mock("@plasmicapp/query", () => ({
  useMutablePlasmicQueryData: (...a: unknown[]) =>
    mockUseMutablePlasmicQueryData(...a),
}));

const mockEpGetProduct = jest.fn();
jest.mock("../ep-server-functions/getProduct", () => ({
  epGetProduct: (...a: unknown[]) => mockEpGetProduct(...a),
}));

const mockUseEpCommerce = jest.fn();
jest.mock("../shopper-context/EpCommerceContext", () => ({
  useEpCommerce: (...a: unknown[]) => mockUseEpCommerce(...a),
}));

const useProduct = require("./use-product").default as typeof import("./use-product").default;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseEpCommerce.mockReturnValue({
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

    it("reads the product through the server function, never the browser", async () => {
      mockEpGetProduct.mockResolvedValue({ id: "prod-1" });

      const product = await runFetcher("blue-shirt");

      expect(mockEpGetProduct).toHaveBeenCalledWith({ id: "blue-shirt" });
      expect(product?.id).toBe("prod-1");
    });

    it("returns null when the reference names no product", async () => {
      mockEpGetProduct.mockResolvedValue(null);

      await expect(runFetcher("gone")).resolves.toBeNull();
    });

    it("rejects when the read fails, so SWR reports an error", async () => {
      mockEpGetProduct.mockRejectedValue(new Error("boom"));

      await expect(runFetcher("blue-shirt")).rejects.toThrow("boom");
    });
  });
});
