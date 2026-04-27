// @jest-environment jsdom
/**
 * Tests for use-update-item hook fetcher.
 *
 * Why: useUpdateItem handles quantity changes with debouncing, delegates to
 * removeItem when quantity drops below 1, validates non-integer quantities,
 * passes location for multi-location inventory, and cleans up cart cookies
 * on 404 errors. Testing ensures these branching paths work correctly.
 */

/* ---------- mock variables ---------- */
const mockGetACart = jest.fn();
const mockUpdateACartItem = jest.fn();

const mockGetCartId = jest.fn();
const mockNormalizeCart = jest.fn();
const mockSetCartId = jest.fn();

const mockRemoveItemFetcher = jest.fn();
const mockGetEPClient = jest.fn().mockReturnValue("mock-client");
const mockHandleAPIError = jest
  .fn()
  .mockReturnValue({ message: "test error" });

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: (...a: unknown[]) => mockGetACart(...a),
  updateACartItem: (...a: unknown[]) => mockUpdateACartItem(...a),
}));

jest.mock("../../utils", () => ({
  normalizeCart: (...a: unknown[]) => mockNormalizeCart(...a),
}));

jest.mock("../cart-session", () => ({
  getCartIdFromSession: () => Promise.resolve(mockGetCartId()),
  setCartIdInSession: async (...a: unknown[]) => mockSetCartId(...a),
}));

jest.mock("../use-remove-item", () => ({
  handler: {
    fetchOptions: { url: "" },
    fetcher: (...a: unknown[]) => mockRemoveItemFetcher(...a),
  },
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

// ValidationError must be a real class so `throw new ValidationError(...)` works
jest.mock("@plasmicpkgs/commerce", () => ({
  useUpdateItem: jest.fn(),
  ValidationError: class ValidationError extends Error {
    constructor({ message }: { message: string }) {
      super(message);
      this.name = "ValidationError";
    }
  },
}));

/* ---------- code under test ---------- */
const { handler } = require("../use-update-item") as typeof import("../use-update-item");

/* ---------- helpers ---------- */
const mockProvider = { locale: "en-US", client: "mock-client" };

function callFetcher(
  item: Record<string, unknown> = { quantity: 3 },
  itemId = "item-123"
) {
  return handler.fetcher({
    input: { item, itemId },
    options: handler.fetchOptions,
    fetch: jest.fn(),
    provider: mockProvider,
  });
}

/* ---------- tests ---------- */
describe("useUpdateItem handler.fetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCartId.mockReturnValue("cart-abc");
    mockUpdateACartItem.mockResolvedValue({});
    mockGetACart.mockResolvedValue({
      data: {
        data: { id: "cart-abc" },
        included: { items: [{ id: "item-123", quantity: 3 }] },
      },
    });
    mockNormalizeCart.mockReturnValue({ id: "cart-abc", lineItems: [] });
  });

  it("updates cart item with new quantity", async () => {
    await callFetcher({ quantity: 5 });

    expect(mockUpdateACartItem).toHaveBeenCalledWith({
      client: "mock-client",
      path: { cartID: "cart-abc", cartitemID: "item-123" },
      body: {
        data: { id: "item-123", quantity: 5 },
      },
    });
  });

  it("delegates to removeItem handler when quantity is 0", async () => {
    mockRemoveItemFetcher.mockResolvedValue({
      id: "cart-abc",
      lineItems: [],
    });

    await callFetcher({ quantity: 0 });

    expect(mockRemoveItemFetcher).toHaveBeenCalled();
    expect(mockUpdateACartItem).not.toHaveBeenCalled();
  });

  it("delegates to removeItem handler when quantity is negative", async () => {
    mockRemoveItemFetcher.mockResolvedValue({
      id: "cart-abc",
      lineItems: [],
    });

    await callFetcher({ quantity: -1 });

    expect(mockRemoveItemFetcher).toHaveBeenCalled();
    expect(mockUpdateACartItem).not.toHaveBeenCalled();
  });

  it("throws ValidationError for non-integer quantity", async () => {
    await expect(callFetcher({ quantity: 2.5 })).rejects.toThrow(
      "The item quantity has to be a valid integer"
    );
  });

  it("returns undefined when no cartId cookie", async () => {
    mockGetCartId.mockReturnValue(undefined);

    const result = await callFetcher({ quantity: 3 });

    expect(result).toBeUndefined();
    expect(mockUpdateACartItem).not.toHaveBeenCalled();
  });

  it("returns undefined when no itemId", async () => {
    const result = await handler.fetcher({
      input: { item: { quantity: 3 }, itemId: "" },
      options: handler.fetchOptions,
      fetch: jest.fn(),
      provider: mockProvider,
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when quantity is undefined", async () => {
    const result = await callFetcher({}, "item-123");

    expect(result).toBeUndefined();
  });

  it("includes location in update body when present", async () => {
    await callFetcher({ quantity: 2, location: "warehouse-east" });

    expect(mockUpdateACartItem).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          data: {
            id: "item-123",
            quantity: 2,
            location: "warehouse-east",
          },
        },
      })
    );
  });

  it("omits location from update body when not present", async () => {
    await callFetcher({ quantity: 2 });

    const callBody = mockUpdateACartItem.mock.calls[0][0].body.data;
    expect(callBody).not.toHaveProperty("location");
  });

  it("returns normalized cart after successful update", async () => {
    mockNormalizeCart.mockReturnValue({
      id: "cart-abc",
      lineItems: [{ id: "item-123", quantity: 5 }],
    });

    const result = await callFetcher({ quantity: 5 });

    expect(result).toEqual({
      id: "cart-abc",
      lineItems: [{ id: "item-123", quantity: 5 }],
    });
  });

  it("passes locale from provider to normalizeCart", async () => {
    await callFetcher({ quantity: 3 });

    expect(mockNormalizeCart).toHaveBeenCalledWith(expect.anything(), "en-US");
  });

  it("returns undefined on API error", async () => {
    mockUpdateACartItem.mockRejectedValue(new Error("Server error"));

    const result = await callFetcher({ quantity: 3 });

    expect(result).toBeUndefined();
    expect(mockHandleAPIError).toHaveBeenCalledWith(
      expect.any(Error),
      "updating cart item"
    );
  });

  it("removes cart cookie on 404 error", async () => {
    const error404 = Object.assign(new Error("Not found"), { status: 404 });
    mockUpdateACartItem.mockRejectedValue(error404);

    await callFetcher({ quantity: 3 });

    expect(mockSetCartId).toHaveBeenCalled();
  });

  it("does not remove cart cookie on non-404 error", async () => {
    mockUpdateACartItem.mockRejectedValue(new Error("Server error"));

    await callFetcher({ quantity: 3 });

    expect(mockSetCartId).not.toHaveBeenCalled();
  });

  it("returns undefined when response data is falsy", async () => {
    mockGetACart.mockResolvedValue({ data: null });

    const result = await callFetcher({ quantity: 3 });

    expect(result).toBeUndefined();
  });
});
