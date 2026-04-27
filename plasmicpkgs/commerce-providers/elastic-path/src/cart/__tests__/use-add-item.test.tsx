// @jest-environment jsdom
/**
 * Tests for use-add-item hook fetcher.
 *
 * Why: useAddItem handles cart creation on first add, item validation via pure
 * functions, building EP-specific cart data, and the add-to-cart API flow.
 * Testing validates the full lifecycle including the locale parameter fix
 * (previously missing provider.locale in normalizeCart call).
 */

/* ---------- mock variables ---------- */
const mockGetACart = jest.fn();
const mockCreateACart = jest.fn();
const mockManageCarts = jest.fn();

const mockGetCartId = jest.fn();
const mockSetCartId = jest.fn();
const mockNormalizeCart = jest.fn();

const mockValidateCartItem = jest.fn();
const mockBuildCartItemData = jest.fn();

const mockGetEPClient = jest.fn().mockReturnValue("mock-client");
const mockHandleAPIError = jest
  .fn()
  .mockReturnValue({ message: "test error" });

/* ---------- jest.mock calls ---------- */
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: (...a: unknown[]) => mockGetACart(...a),
  createACart: (...a: unknown[]) => mockCreateACart(...a),
  manageCarts: (...a: unknown[]) => mockManageCarts(...a),
}));

jest.mock("../../utils", () => ({
  normalizeCart: (...a: unknown[]) => mockNormalizeCart(...a),
}));

jest.mock("../cart-session", () => ({
  getCartIdFromSession: () => Promise.resolve(mockGetCartId()),
  setCartIdInSession: async (...a: unknown[]) => mockSetCartId(...a),
}));

jest.mock("../utils/cartDataBuilder", () => ({
  validateCartItem: (...a: unknown[]) => mockValidateCartItem(...a),
  buildCartItemData: (...a: unknown[]) => mockBuildCartItemData(...a),
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
  useAddItem: jest.fn(),
}));

/* ---------- code under test ---------- */
const { handler } = require("../use-add-item") as typeof import("../use-add-item");

/* ---------- helpers ---------- */
const mockProvider = { locale: "en-US", client: "mock-client" };
const validItem = {
  productId: "prod-123",
  variantId: "var-456",
  quantity: 2,
};

function callFetcher(item = validItem) {
  return handler.fetcher({
    input: item,
    options: handler.fetchOptions,
    fetch: jest.fn(),
    provider: mockProvider,
  });
}

/* ---------- tests ---------- */
describe("useAddItem handler.fetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCartItem.mockReturnValue({ isValid: true });
    mockBuildCartItemData.mockReturnValue({
      type: "cart_item",
      id: "prod-123",
      quantity: 2,
    });
    mockGetCartId.mockReturnValue("cart-abc");
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue({
      data: {
        data: { id: "cart-abc" },
        included: { items: [] },
      },
    });
    mockNormalizeCart.mockReturnValue({ id: "cart-abc", lineItems: [] });
  });

  it("validates cart item before proceeding", async () => {
    await callFetcher();

    expect(mockValidateCartItem).toHaveBeenCalledWith(validItem);
  });

  it("returns undefined when validation fails", async () => {
    mockValidateCartItem.mockReturnValue({
      isValid: false,
      errorMessage: "Missing productId",
    });

    const result = await callFetcher();

    expect(result).toBeUndefined();
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("creates cart if no cartId cookie exists", async () => {
    mockGetCartId.mockReturnValue(undefined);
    mockCreateACart.mockResolvedValue({
      data: { data: { id: "new-cart-789" } },
    });

    await callFetcher();

    expect(mockCreateACart).toHaveBeenCalledWith({
      client: "mock-client",
      body: {
        data: { name: "Cart", description: "Shopping cart" },
      },
    });
  });

  it("sets cartId cookie after creating cart", async () => {
    mockGetCartId.mockReturnValue(undefined);
    mockCreateACart.mockResolvedValue({
      data: { data: { id: "new-cart-789" } },
    });

    await callFetcher();

    expect(mockSetCartId).toHaveBeenCalledWith("new-cart-789");
  });

  it("uses existing cartId when cookie is present", async () => {
    mockGetCartId.mockReturnValue("existing-cart");

    await callFetcher();

    expect(mockCreateACart).not.toHaveBeenCalled();
    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "existing-cart" },
      })
    );
  });

  it("builds cart item data with validated item", async () => {
    await callFetcher();

    expect(mockBuildCartItemData).toHaveBeenCalledWith(validItem);
  });

  it("calls manageCarts with correct cart ID and built data", async () => {
    mockBuildCartItemData.mockReturnValue({
      type: "cart_item",
      id: "prod-123",
      quantity: 2,
    });

    await callFetcher();

    expect(mockManageCarts).toHaveBeenCalledWith({
      client: "mock-client",
      path: { cartID: "cart-abc" },
      body: {
        data: { type: "cart_item", id: "prod-123", quantity: 2 },
      },
    });
  });

  it("fetches updated cart with items included after add", async () => {
    await callFetcher();

    expect(mockGetACart).toHaveBeenCalledWith({
      client: "mock-client",
      path: { cartID: "cart-abc" },
      query: { include: ["items"] },
    });
  });

  it("returns normalized cart after successful add", async () => {
    mockNormalizeCart.mockReturnValue({
      id: "cart-abc",
      lineItems: [{ id: "item-1" }],
    });

    const result = await callFetcher();

    expect(result).toEqual({
      id: "cart-abc",
      lineItems: [{ id: "item-1" }],
    });
  });

  it("passes locale from provider to normalizeCart", async () => {
    await callFetcher();

    expect(mockNormalizeCart).toHaveBeenCalledWith(expect.anything(), "en-US");
  });

  it("returns undefined when cart creation returns no data", async () => {
    mockGetCartId.mockReturnValue(undefined);
    mockCreateACart.mockResolvedValue({ data: null });

    const result = await callFetcher();

    expect(result).toBeUndefined();
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("returns undefined on API error during add", async () => {
    mockManageCarts.mockRejectedValue(new Error("API failure"));

    const result = await callFetcher();

    expect(result).toBeUndefined();
    expect(mockHandleAPIError).toHaveBeenCalledWith(
      expect.any(Error),
      "adding item to cart"
    );
  });

  it("returns undefined when cart response data is falsy after add", async () => {
    mockGetACart.mockResolvedValue({ data: null });

    const result = await callFetcher();

    expect(result).toBeUndefined();
  });
});
