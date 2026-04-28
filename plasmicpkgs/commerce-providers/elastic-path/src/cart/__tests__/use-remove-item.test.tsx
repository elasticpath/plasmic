// @jest-environment jsdom
/**
 * Tests for use-remove-item hook fetcher.
 *
 * Why: useRemoveItem uses deleteACartItem (DELETE endpoint) rather than
 * setting quantity to zero — a common gotcha with the EP API. Testing
 * validates correct API call shape, cart refresh after deletion, cookie
 * cleanup on 404 errors, and guard conditions (missing cartId/itemId).
 */

/* ---------- mock variables ---------- */
const mockGetACart = jest.fn();
const mockDeleteACartItem = jest.fn();

const mockGetCartId = jest.fn();
const mockNormalizeCart = jest.fn();
const mockSetCartId = jest.fn();

const mockGetEPClient = jest.fn().mockReturnValue("mock-client");
const mockHandleAPIError = jest
  .fn()
  .mockReturnValue({ message: "test error" });

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: (...a: unknown[]) => mockGetACart(...a),
  deleteACartItem: (...a: unknown[]) => mockDeleteACartItem(...a),
}));

jest.mock("../../utils", () => ({
  normalizeCart: (...a: unknown[]) => mockNormalizeCart(...a),
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

jest.mock("../use-cart", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@plasmicpkgs/commerce", () => ({
  useRemoveItem: jest.fn(),
  ValidationError: class ValidationError extends Error {
    constructor({ message }: { message: string }) {
      super(message);
      this.name = "ValidationError";
    }
  },
}));

/* ---------- code under test ---------- */
const { handler } = require("../use-remove-item") as typeof import("../use-remove-item");

/* ---------- helpers ---------- */
const mockProvider = { locale: "en-US", client: "mock-client" };

function callFetcher(itemId = "item-123") {
  return handler.fetcher({
    input: { itemId },
    options: handler.fetchOptions,
    fetch: jest.fn(),
    provider: mockProvider,
  });
}

/* ---------- tests ---------- */
describe("useRemoveItem handler.fetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCartId.mockReturnValue("cart-abc");
    mockDeleteACartItem.mockResolvedValue({});
    mockGetACart.mockResolvedValue({
      data: {
        data: { id: "cart-abc" },
        included: { items: [] },
      },
    });
    mockNormalizeCart.mockReturnValue({ id: "cart-abc", lineItems: [] });
  });

  it("deletes cart item via deleteACartItem API", async () => {
    await callFetcher("item-456");

    expect(mockDeleteACartItem).toHaveBeenCalledWith({
      client: "mock-client",
      path: { cartID: "cart-abc", cartitemID: "item-456" },
    });
  });

  it("fetches updated cart with items included after removal", async () => {
    await callFetcher();

    expect(mockGetACart).toHaveBeenCalledWith({
      client: "mock-client",
      path: { cartID: "cart-abc" },
      query: { include: ["items"] },
    });
  });

  it("returns normalized cart after successful removal", async () => {
    mockNormalizeCart.mockReturnValue({ id: "cart-abc", lineItems: [] });

    const result = await callFetcher();

    expect(result).toEqual({ id: "cart-abc", lineItems: [] });
  });

  it("passes locale from provider to normalizeCart", async () => {
    await callFetcher();

    expect(mockNormalizeCart).toHaveBeenCalledWith(expect.anything(), "en-US");
  });

  it("returns undefined when no cartId cookie", async () => {
    mockGetCartId.mockReturnValue(undefined);

    const result = await callFetcher();

    expect(result).toBeUndefined();
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
  });

  it("returns undefined when no itemId", async () => {
    const result = await handler.fetcher({
      input: { itemId: "" },
      options: handler.fetchOptions,
      fetch: jest.fn(),
      provider: mockProvider,
    });

    expect(result).toBeUndefined();
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
  });

  it("removes cart cookie when updated cart has no data", async () => {
    mockGetACart.mockResolvedValue({ data: null });

    await callFetcher();

    expect(mockSetCartId).toHaveBeenCalled();
  });

  it("returns undefined when updated cart has no data", async () => {
    mockGetACart.mockResolvedValue({ data: null });

    const result = await callFetcher();

    expect(result).toBeUndefined();
  });

  it("returns undefined on API error", async () => {
    mockDeleteACartItem.mockRejectedValue(new Error("Server error"));

    const result = await callFetcher();

    expect(result).toBeUndefined();
    expect(mockHandleAPIError).toHaveBeenCalledWith(
      expect.any(Error),
      "removing item from cart"
    );
  });

  it("removes cart cookie on 404 error", async () => {
    const error404 = Object.assign(new Error("Not found"), { status: 404 });
    mockDeleteACartItem.mockRejectedValue(error404);

    await callFetcher();

    expect(mockSetCartId).toHaveBeenCalled();
  });

  it("does not remove cart cookie on non-404 error", async () => {
    mockDeleteACartItem.mockRejectedValue(new Error("Server error"));

    await callFetcher();

    expect(mockSetCartId).not.toHaveBeenCalled();
  });

  it("uses getEPClient to extract SDK client from provider", async () => {
    await callFetcher();

    expect(mockGetEPClient).toHaveBeenCalledWith(mockProvider);
  });
});
