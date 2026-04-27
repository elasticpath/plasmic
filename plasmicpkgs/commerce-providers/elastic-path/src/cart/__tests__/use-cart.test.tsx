// @jest-environment jsdom
/**
 * Tests for use-cart hook fetcher.
 *
 * Why: useCart is the foundational cart hook — every mutation hook (add, update,
 * remove) depends on it for cache invalidation via mutate(). Testing the fetcher
 * validates cart creation, retrieval, cookie management, locale passthrough to
 * normalizeCart, and error recovery.
 */

/* ---------- mock variables (declared before jest.mock) ---------- */
const mockGetACart = jest.fn();
const mockCreateACart = jest.fn();

const mockGetCartId = jest.fn();
const mockSetCartId = jest.fn();

const mockNormalizeCart = jest.fn();
const mockGetEPClient = jest.fn().mockReturnValue("mock-client");
const mockHandleAPIError = jest
  .fn()
  .mockReturnValue({ message: "test error" });

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: (...a: unknown[]) => mockGetACart(...a),
  createACart: (...a: unknown[]) => mockCreateACart(...a),
}));

jest.mock("../../utils", () => ({
  normalizeCart: (...a: unknown[]) => mockNormalizeCart(...a),
}));

jest.mock("../cart-session", () => ({
  getCartIdFromSession: () => Promise.resolve(mockGetCartId()),
  setCartIdInSession: async (...a: unknown[]) => mockSetCartId(...a),
}));

jest.mock("../cart-session", () => ({
  getCartIdFromSession: () => Promise.resolve(mockGetCartId()),
  setCartIdInSession: async (...a: unknown[]) => mockSetCartId(...a),
}));

jest.mock("../../utils/errorHandling", () => ({
  handleAPIError: (...a: unknown[]) => mockHandleAPIError(...a),
}));

jest.mock("../../utils/getEPClient", () => ({
  getEPClient: (...a: unknown[]) => mockGetEPClient(...a),
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
  useCart: jest.fn(),
}));

/* ---------- code under test (after mocks) ---------- */
const { handler } = require("../use-cart") as typeof import("../use-cart");

/* ---------- helpers ---------- */
const mockProvider = { locale: "en-US", client: "mock-client" };

function makeCartResponse(cartId: string, items: unknown[] = []) {
  return {
    data: {
      data: {
        id: cartId,
        meta: {
          display_price: {
            without_tax: { amount: 1000, currency: "USD" },
          },
          timestamps: { created_at: "2026-01-01T00:00:00Z" },
        },
      },
      included: { items },
    },
  };
}

function callFetcher() {
  return handler.fetcher({
    input: {},
    options: handler.fetchOptions,
    fetch: jest.fn(),
    provider: mockProvider,
  });
}

/* ---------- tests ---------- */
describe("useCart handler.fetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches existing cart when cartId cookie exists", async () => {
    mockGetCartId.mockReturnValue("cart-abc");
    const cartResp = makeCartResponse("cart-abc");
    mockGetACart.mockResolvedValue(cartResp);
    mockNormalizeCart.mockReturnValue({ id: "cart-abc", lineItems: [] });

    const result = await callFetcher();

    expect(mockGetACart).toHaveBeenCalledWith({
      client: "mock-client",
      path: { cartID: "cart-abc" },
      query: { include: ["items"] },
    });
    expect(result).toEqual({ id: "cart-abc", lineItems: [] });
  });

  it("passes locale from provider to normalizeCart", async () => {
    mockGetCartId.mockReturnValue("cart-abc");
    const cartResp = makeCartResponse("cart-abc");
    mockGetACart.mockResolvedValue(cartResp);
    mockNormalizeCart.mockReturnValue({ id: "cart-abc" });

    await callFetcher();

    expect(mockNormalizeCart).toHaveBeenCalledWith(cartResp.data, "en-US");
  });

  it("creates new cart when no cartId cookie exists", async () => {
    mockGetCartId.mockReturnValue(undefined);
    const createResp = {
      data: { data: { id: "new-cart-123" } },
    };
    mockCreateACart.mockResolvedValue(createResp);
    mockNormalizeCart.mockReturnValue({ id: "new-cart-123", lineItems: [] });

    const result = await callFetcher();

    expect(mockCreateACart).toHaveBeenCalledWith({
      client: "mock-client",
      body: {
        data: { name: "Cart", description: "Shopping cart" },
      },
    });
    expect(result).toEqual({ id: "new-cart-123", lineItems: [] });
  });

  it("sets cartId cookie after creating new cart", async () => {
    mockGetCartId.mockReturnValue(undefined);
    mockCreateACart.mockResolvedValue({
      data: { data: { id: "new-cart-456" } },
    });
    mockNormalizeCart.mockReturnValue({ id: "new-cart-456" });

    await callFetcher();

    expect(mockSetCartId).toHaveBeenCalledWith("new-cart-456");
  });

  it("returns undefined on API error", async () => {
    mockGetCartId.mockReturnValue("cart-abc");
    mockGetACart.mockRejectedValue(new Error("Network failure"));

    const result = await callFetcher();

    expect(result).toBeUndefined();
    expect(mockHandleAPIError).toHaveBeenCalledWith(
      expect.any(Error),
      "getting cart"
    );
  });

  it("does not create a new cart when existing cart fetch succeeds", async () => {
    mockGetCartId.mockReturnValue("cart-existing");
    mockGetACart.mockResolvedValue(makeCartResponse("cart-existing"));
    mockNormalizeCart.mockReturnValue({ id: "cart-existing" });

    await callFetcher();

    expect(mockCreateACart).not.toHaveBeenCalled();
  });

  it("returns null when new cart response data is falsy", async () => {
    mockGetCartId.mockReturnValue(undefined);
    mockCreateACart.mockResolvedValue({ data: null });

    const result = await callFetcher();

    expect(result).toBeNull();
  });

  it("returns null when existing cart response data is falsy", async () => {
    mockGetCartId.mockReturnValue("cart-abc");
    mockGetACart.mockResolvedValue({ data: undefined });

    const result = await callFetcher();

    expect(result).toBeNull();
  });

  it("uses getEPClient to extract SDK client from provider", async () => {
    mockGetCartId.mockReturnValue("cart-abc");
    mockGetACart.mockResolvedValue(makeCartResponse("cart-abc"));
    mockNormalizeCart.mockReturnValue({ id: "cart-abc" });

    await callFetcher();

    expect(mockGetEPClient).toHaveBeenCalledWith(mockProvider);
  });
});
