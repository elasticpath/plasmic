// Mock logger before any imports that use it
const mockError = jest.fn();
jest.mock("../logger", () => ({
  createLogger: () => ({
    error: mockError,
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Use require after mock to avoid esbuild import hoisting
const {
  EPErrorCode,
  createEPError,
  createStockError,
  createCartValidationError,
  handleAPIError,
  formatUserErrorMessage,
  isRecoverableError,
  logError,
  createFormContextError,
} = require("../errorHandling");

// Type alias for convenience in test assertions
type EPError = {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
};

describe("errorHandling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── EPErrorCode enum ────────────────────────────────────────────────

  describe("EPErrorCode", () => {
    it("should define all stock-related codes", () => {
      expect(EPErrorCode.STOCK_UNAVAILABLE).toBe("STOCK_UNAVAILABLE");
      expect(EPErrorCode.STOCK_INSUFFICIENT).toBe("STOCK_INSUFFICIENT");
      expect(EPErrorCode.STOCK_FETCH_FAILED).toBe("STOCK_FETCH_FAILED");
    });

    it("should define all cart-related codes", () => {
      expect(EPErrorCode.CART_INVALID_QUANTITY).toBe("CART_INVALID_QUANTITY");
      expect(EPErrorCode.CART_ITEM_INVALID).toBe("CART_ITEM_INVALID");
      expect(EPErrorCode.CART_ADD_FAILED).toBe("CART_ADD_FAILED");
    });

    it("should define all product-related codes", () => {
      expect(EPErrorCode.PRODUCT_NOT_FOUND).toBe("PRODUCT_NOT_FOUND");
      expect(EPErrorCode.PRODUCT_NOT_BUNDLE).toBe("PRODUCT_NOT_BUNDLE");
      expect(EPErrorCode.PRODUCT_INVALID).toBe("PRODUCT_INVALID");
    });

    it("should define all location-related codes", () => {
      expect(EPErrorCode.LOCATION_NOT_FOUND).toBe("LOCATION_NOT_FOUND");
      expect(EPErrorCode.LOCATION_FETCH_FAILED).toBe("LOCATION_FETCH_FAILED");
    });

    it("should define all API/system-related codes", () => {
      expect(EPErrorCode.API_ERROR).toBe("API_ERROR");
      expect(EPErrorCode.NETWORK_ERROR).toBe("NETWORK_ERROR");
      expect(EPErrorCode.UNKNOWN_ERROR).toBe("UNKNOWN_ERROR");
    });
  });

  // ── createEPError ───────────────────────────────────────────────────

  describe("createEPError", () => {
    it("should create an error with required fields", () => {
      const err: EPError = createEPError(EPErrorCode.API_ERROR, "Something broke");

      expect(err.code).toBe(EPErrorCode.API_ERROR);
      expect(err.message).toBe("Something broke");
      expect(err.timestamp).toBeDefined();
    });

    it("should produce a valid ISO 8601 timestamp", () => {
      const err: EPError = createEPError(EPErrorCode.API_ERROR, "test");
      const parsed = Date.parse(err.timestamp);

      expect(Number.isNaN(parsed)).toBe(false);
      expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
    });

    it("should include details when provided", () => {
      const details = { orderId: "abc-123", retryCount: 3 };
      const err: EPError = createEPError(EPErrorCode.API_ERROR, "msg", details);

      expect(err.details).toEqual(details);
    });

    it("should leave details undefined when not provided", () => {
      const err: EPError = createEPError(EPErrorCode.API_ERROR, "msg");

      expect(err.details).toBeUndefined();
    });
  });

  // ── createStockError ────────────────────────────────────────────────

  describe("createStockError", () => {
    it("should use STOCK_UNAVAILABLE when available stock is 0", () => {
      const err: EPError = createStockError("Out of stock", 0, 5);

      expect(err.code).toBe(EPErrorCode.STOCK_UNAVAILABLE);
      expect(err.message).toBe("Out of stock");
      expect(err.details).toEqual({ availableStock: 0, requestedQuantity: 5 });
    });

    it("should use STOCK_INSUFFICIENT when available stock is greater than 0", () => {
      const err: EPError = createStockError("Not enough", 3, 10);

      expect(err.code).toBe(EPErrorCode.STOCK_INSUFFICIENT);
      expect(err.details).toEqual({ availableStock: 3, requestedQuantity: 10 });
    });

    it("should include a valid timestamp", () => {
      const err: EPError = createStockError("err", 0, 1);

      expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
    });
  });

  // ── createCartValidationError ───────────────────────────────────────

  describe("createCartValidationError", () => {
    it("should always use CART_ITEM_INVALID code", () => {
      const err: EPError = createCartValidationError("Bad item");

      expect(err.code).toBe(EPErrorCode.CART_ITEM_INVALID);
      expect(err.message).toBe("Bad item");
    });

    it("should pass itemData through in details", () => {
      const itemData = { sku: "WIDGET-1", quantity: -1 };
      const err: EPError = createCartValidationError("Invalid", itemData);

      expect(err.details).toEqual({ itemData });
    });

    it("should set itemData to undefined in details when not provided", () => {
      const err: EPError = createCartValidationError("No data");

      expect(err.details).toEqual({ itemData: undefined });
    });
  });

  // ── handleAPIError ──────────────────────────────────────────────────

  describe("handleAPIError", () => {
    it("should classify errors with 'fetch' in the message as NETWORK_ERROR", () => {
      const err: EPError = handleAPIError(new Error("fetch failed"));

      expect(err.code).toBe(EPErrorCode.NETWORK_ERROR);
      expect(err.message).toContain("fetch failed");
    });

    it("should classify errors with 'network' in the message as NETWORK_ERROR", () => {
      const err: EPError = handleAPIError(new Error("network timeout"));

      expect(err.code).toBe(EPErrorCode.NETWORK_ERROR);
      expect(err.details).toEqual({ originalError: "network timeout" });
    });

    it("should classify other Error instances as API_ERROR", () => {
      const err: EPError = handleAPIError(new Error("500 Internal Server Error"));

      expect(err.code).toBe(EPErrorCode.API_ERROR);
      expect(err.message).toContain("500 Internal Server Error");
    });

    it("should classify non-Error values as UNKNOWN_ERROR", () => {
      const err: EPError = handleAPIError("some string error");

      expect(err.code).toBe(EPErrorCode.UNKNOWN_ERROR);
      expect(err.details).toEqual({ originalError: "some string error" });
    });

    it("should handle null as UNKNOWN_ERROR", () => {
      const err: EPError = handleAPIError(null);

      expect(err.code).toBe(EPErrorCode.UNKNOWN_ERROR);
      expect(err.details).toEqual({ originalError: "null" });
    });

    it("should handle undefined as UNKNOWN_ERROR", () => {
      const err: EPError = handleAPIError(undefined);

      expect(err.code).toBe(EPErrorCode.UNKNOWN_ERROR);
      expect(err.details).toEqual({ originalError: "undefined" });
    });

    it("should default context to 'API call'", () => {
      const err: EPError = handleAPIError(new Error("oops"));

      expect(err.message).toContain("API call");
    });

    it("should include custom context in the message", () => {
      const err: EPError = handleAPIError(new Error("oops"), "fetching products");

      expect(err.message).toContain("fetching products");
    });
  });

  // ── formatUserErrorMessage ──────────────────────────────────────────

  describe("formatUserErrorMessage", () => {
    it("should return out-of-stock message for STOCK_UNAVAILABLE", () => {
      const err: EPError = createEPError(EPErrorCode.STOCK_UNAVAILABLE, "internal");

      expect(formatUserErrorMessage(err)).toBe("This item is currently out of stock");
    });

    it("should return specific count for STOCK_INSUFFICIENT with availableStock", () => {
      const err: EPError = createEPError(EPErrorCode.STOCK_INSUFFICIENT, "internal", {
        availableStock: 7,
      });

      expect(formatUserErrorMessage(err)).toBe("Only 7 items available");
    });

    it("should return generic message for STOCK_INSUFFICIENT without availableStock", () => {
      const err: EPError = createEPError(EPErrorCode.STOCK_INSUFFICIENT, "internal");

      expect(formatUserErrorMessage(err)).toBe("Not enough stock available");
    });

    it("should return quantity message for CART_INVALID_QUANTITY", () => {
      const err: EPError = createEPError(EPErrorCode.CART_INVALID_QUANTITY, "internal");

      expect(formatUserErrorMessage(err)).toBe("Please enter a valid quantity");
    });

    it("should return not-found message for PRODUCT_NOT_FOUND", () => {
      const err: EPError = createEPError(EPErrorCode.PRODUCT_NOT_FOUND, "internal");

      expect(formatUserErrorMessage(err)).toBe("Product not found");
    });

    it("should return not-found message for LOCATION_NOT_FOUND", () => {
      const err: EPError = createEPError(EPErrorCode.LOCATION_NOT_FOUND, "internal");

      expect(formatUserErrorMessage(err)).toBe("Location not found");
    });

    it("should return network message for NETWORK_ERROR", () => {
      const err: EPError = createEPError(EPErrorCode.NETWORK_ERROR, "internal");

      expect(formatUserErrorMessage(err)).toBe("Network connection error. Please try again.");
    });

    it("should fall back to error.message for unhandled codes", () => {
      const err: EPError = createEPError(EPErrorCode.CART_ADD_FAILED, "Cart add exploded");

      expect(formatUserErrorMessage(err)).toBe("Cart add exploded");
    });

    it("should fall back to generic message when error.message is empty", () => {
      const err: EPError = createEPError(EPErrorCode.UNKNOWN_ERROR, "");

      expect(formatUserErrorMessage(err)).toBe("An unexpected error occurred");
    });
  });

  // ── isRecoverableError ──────────────────────────────────────────────

  describe("isRecoverableError", () => {
    it.each([
      EPErrorCode.CART_INVALID_QUANTITY,
      EPErrorCode.STOCK_INSUFFICIENT,
      EPErrorCode.NETWORK_ERROR,
    ])("should return true for recoverable code %s", (code: string) => {
      const err: EPError = createEPError(code, "msg");
      expect(isRecoverableError(err)).toBe(true);
    });

    it.each([
      EPErrorCode.STOCK_UNAVAILABLE,
      EPErrorCode.STOCK_FETCH_FAILED,
      EPErrorCode.CART_ITEM_INVALID,
      EPErrorCode.CART_ADD_FAILED,
      EPErrorCode.PRODUCT_NOT_FOUND,
      EPErrorCode.PRODUCT_NOT_BUNDLE,
      EPErrorCode.PRODUCT_INVALID,
      EPErrorCode.LOCATION_NOT_FOUND,
      EPErrorCode.LOCATION_FETCH_FAILED,
      EPErrorCode.API_ERROR,
      EPErrorCode.UNKNOWN_ERROR,
    ])("should return false for non-recoverable code %s", (code: string) => {
      const err: EPError = createEPError(code, "msg");
      expect(isRecoverableError(err)).toBe(false);
    });
  });

  // ── logError ────────────────────────────────────────────────────────

  describe("logError", () => {
    it("should call log.error with formatted message and metadata", () => {
      const err: EPError = createEPError(EPErrorCode.API_ERROR, "Server failure");
      logError(err, "checkout");

      expect(mockError).toHaveBeenCalledTimes(1);
      expect(mockError).toHaveBeenCalledWith(
        `${EPErrorCode.API_ERROR}: Server failure`,
        expect.objectContaining({
          error: err,
          context: "checkout",
          timestamp: err.timestamp,
        })
      );
    });

    it("should pass undefined context when not provided", () => {
      const err: EPError = createEPError(EPErrorCode.NETWORK_ERROR, "timeout");
      logError(err);

      expect(mockError).toHaveBeenCalledWith(
        `${EPErrorCode.NETWORK_ERROR}: timeout`,
        expect.objectContaining({
          error: err,
          context: undefined,
        })
      );
    });
  });

  // ── createFormContextError ──────────────────────────────────────────

  describe("createFormContextError", () => {
    it("should create a CART_ITEM_INVALID error referencing the component name", () => {
      const err: EPError = createFormContextError("QuantitySelector");

      expect(err.code).toBe(EPErrorCode.CART_ITEM_INVALID);
      expect(err.message).toBe(
        "QuantitySelector must be used within a ProductProvider that provides a form context"
      );
    });

    it("should not include details", () => {
      const err: EPError = createFormContextError("AddToCartButton");

      expect(err.details).toBeUndefined();
    });

    it("should include a valid ISO timestamp", () => {
      const err: EPError = createFormContextError("BundleBuilder");

      expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
    });
  });
});
