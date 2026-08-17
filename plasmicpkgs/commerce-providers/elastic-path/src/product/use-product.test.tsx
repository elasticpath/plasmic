/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";

const mockUseMutablePlasmicQueryData = jest.fn();
jest.mock("@plasmicapp/query", () => ({
  useMutablePlasmicQueryData: (...a: unknown[]) =>
    mockUseMutablePlasmicQueryData(...a),
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
});
