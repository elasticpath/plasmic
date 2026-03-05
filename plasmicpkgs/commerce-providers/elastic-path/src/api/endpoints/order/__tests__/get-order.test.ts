/**
 * Tests for the get-order endpoint handler.
 *
 * Covers: environment validation, HTTP method enforcement, orderId validation,
 * successful order retrieval & transformation, and all error branches
 * (CheckoutError passthrough, handleElasticPathError, 404 → OrderError).
 */

// ---------------------------------------------------------------------------
// Mock external dependencies before any imports
// ---------------------------------------------------------------------------

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getAnOrder: jest.fn(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock("../../../../utils/formatCurrency", () => ({
  formatCurrencyFromCents: jest.fn(
    (amount: number, currency: string) => `$${(amount / 100).toFixed(2)}`
  ),
}));

jest.mock("../../../utils/api-helpers", () => ({
  createSuccessResponse: jest.fn((data: any) => ({ success: true, data })),
  createErrorResponse: jest.fn(
    (msg: string, code?: string, details?: any) => ({
      success: false,
      error: { message: msg, code, details },
    })
  ),
  validateMethod: jest.fn(
    (req: any, methods: string[]) => methods.includes(req.method)
  ),
}));

jest.mock("../../../utils/validation", () => ({
  validateEnvironmentVariables: jest.fn(),
}));

jest.mock("../../../utils/error-handling", () => {
  class CheckoutError extends Error {
    code: string;
    details?: any;
    constructor(msg: string, code = "CHECKOUT_ERROR", details?: any) {
      super(msg);
      this.code = code;
      this.details = details;
    }
  }
  class ValidationError extends CheckoutError {
    constructor(msg: string, details?: any) {
      super(msg, "VALIDATION_ERROR", details);
    }
  }
  class OrderError extends CheckoutError {
    constructor(msg: string, details?: any) {
      super(msg, "ORDER_ERROR", details);
    }
  }
  return {
    CheckoutError,
    ValidationError,
    OrderError,
    handleElasticPathError: jest.fn(
      (err: any) => new CheckoutError(err?.message || "EP error")
    ),
    logError: jest.fn(),
    getHttpStatusForError: jest.fn((err: any) => {
      if (err.code === "VALIDATION_ERROR") return 400;
      if (err.code === "ORDER_ERROR") return 404;
      if (err.code === "ELASTIC_PATH_ERROR") return 502;
      return 500;
    }),
  };
});

// ---------------------------------------------------------------------------
// Use require after mocks to avoid esbuild import hoisting
// ---------------------------------------------------------------------------

const getOrderHandler = require("../get-order").default;
const { getAnOrder } = require("@epcc-sdk/sdks-shopper");
const {
  createSuccessResponse,
  createErrorResponse,
  validateMethod,
} = require("../../../utils/api-helpers");
const {
  validateEnvironmentVariables,
} = require("../../../utils/validation");
const {
  handleElasticPathError,
  logError,
  getHttpStatusForError,
  CheckoutError,
  ValidationError,
  OrderError,
} = require("../../../utils/error-handling");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockReq(method: string, query: any = {}) {
  return { method, query };
}

function createMockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function buildEpOrderResponse(overrides: any = {}) {
  return {
    data: {
      data: {
        id: "order-001",
        status: "complete",
        payment: "paid",
        customer: {
          name: "Jane Doe",
          email: "jane@example.com",
        },
        billing_address: {
          line_1: "123 Main St",
          city: "Portland",
          country: "US",
          postcode: "97201",
        },
        shipping_address: {
          line_1: "123 Main St",
          city: "Portland",
          country: "US",
          postcode: "97201",
        },
        meta: {
          display_price: {
            with_tax: { amount: 5000, currency: "USD" },
            without_tax: { amount: 4500, currency: "USD" },
            tax: { amount: 500, currency: "USD" },
          },
          timestamps: {
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          },
        },
        relationships: {
          items: { data: [{ type: "order_item", id: "item-1" }] },
          customer: { data: { type: "customer", id: "cust-1" } },
          transactions: { data: [] },
        },
        ...overrides,
      },
      included: [
        {
          type: "order_item",
          id: "item-1",
          name: "Widget",
          quantity: 1,
        },
        {
          type: "customer",
          id: "cust-1",
          name: "Jane Doe",
          email: "jane@example.com",
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Environment variable management
// ---------------------------------------------------------------------------

const envBackup: Record<string, string | undefined> = {};

beforeAll(() => {
  envBackup.EP_CLIENT_ID = process.env.EP_CLIENT_ID;
  envBackup.EP_HOST = process.env.EP_HOST;
});

afterAll(() => {
  Object.entries(envBackup).forEach(([key, val]) => {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  // Reset implementations that may have been overridden by individual tests
  (validateEnvironmentVariables as jest.Mock).mockReset();
  (validateMethod as jest.Mock).mockImplementation(
    (req: any, methods: string[]) => methods.includes(req.method)
  );
  process.env.EP_CLIENT_ID = "test-client-id";
  process.env.EP_HOST = "https://api.moltin.com";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getOrderHandler", () => {
  // -----------------------------------------------------------------------
  // 1. Successful order retrieval
  // -----------------------------------------------------------------------
  describe("successful order retrieval", () => {
    it("returns 200 with the transformed order when getAnOrder succeeds", async () => {
      const epResponse = buildEpOrderResponse();
      (getAnOrder as jest.Mock).mockResolvedValue(epResponse);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      // Verify environment validation was called
      expect(validateEnvironmentVariables).toHaveBeenCalledTimes(1);

      // Verify method validation
      expect(validateMethod).toHaveBeenCalledWith(req, ["GET"]);

      // Verify getAnOrder was called with the correct parameters
      expect(getAnOrder).toHaveBeenCalledTimes(1);
      expect(getAnOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          client: {
            settings: {
              application_id: "test-client-id",
              host: "https://api.moltin.com",
            },
          },
          path: { orderID: "order-001" },
          query: { include: ["items", "customer", "transactions"] },
        })
      );

      // Verify success response
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledTimes(1);

      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.success).toBe(true);

      // Check the transformed order within the success wrapper
      const order = jsonArg.data.order;
      expect(order.id).toBe("order-001");
      expect(order.type).toBe("order");
      expect(order.status).toBe("complete");
      expect(order.total).toEqual({ amount: 5000, currency: "USD" });
      expect(order.subtotal).toEqual({ amount: 4500, currency: "USD" });
      expect(order.tax).toEqual({ amount: 500, currency: "USD" });
      expect(order.billing_address).toBeDefined();
      expect(order.shipping_address).toBeDefined();
    });

    it("maps included items and customer into the transformed order", async () => {
      const epResponse = buildEpOrderResponse();
      (getAnOrder as jest.Mock).mockResolvedValue(epResponse);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      const order = res.json.mock.calls[0][0].data.order;

      // Items should be mapped via relationships → included
      expect(order.relationships.items.data).toHaveLength(1);
      expect(order.relationships.items.data[0].id).toBe("item-1");

      // Meta should contain the resolved items array
      expect(order.meta.items).toHaveLength(1);
      expect(order.meta.items[0].name).toBe("Widget");

      // Timestamps should be forwarded
      expect(order.meta.timestamps.created_at).toBe("2026-01-01T00:00:00Z");
      expect(order.meta.timestamps.updated_at).toBe("2026-01-02T00:00:00Z");
    });

    it("resolves customer from included data via relationships", async () => {
      // Build a response where the customer only lives in `included`
      const epResponse = buildEpOrderResponse({
        customer: undefined, // remove inline customer
      });
      (getAnOrder as jest.Mock).mockResolvedValue(epResponse);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      const order = res.json.mock.calls[0][0].data.order;
      // Customer resolved from included via relationships.customer.data
      expect(order.customer).toBeDefined();
      expect(order.customer.name).toBe("Jane Doe");
      expect(order.customer.email).toBe("jane@example.com");
    });

    it("determines payment status as 'pending' when no transactions exist", async () => {
      const epResponse = buildEpOrderResponse();
      (getAnOrder as jest.Mock).mockResolvedValue(epResponse);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      const order = res.json.mock.calls[0][0].data.order;
      // transactions.data is [] so payment should be "pending"
      expect(order.payment).toBe("pending");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Method not allowed
  // -----------------------------------------------------------------------
  describe("HTTP method validation", () => {
    it("returns 405 when the request method is POST", async () => {
      const req = createMockReq("POST", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ message: "Method not allowed" }),
        })
      );
      // getAnOrder should never be called
      expect(getAnOrder).not.toHaveBeenCalled();
    });

    it("returns 405 when the request method is PUT", async () => {
      const req = createMockReq("PUT", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(getAnOrder).not.toHaveBeenCalled();
    });

    it("returns 405 when the request method is DELETE", async () => {
      const req = createMockReq("DELETE", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(getAnOrder).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 3. Missing orderId
  // -----------------------------------------------------------------------
  describe("missing orderId", () => {
    it("returns a ValidationError (400) when orderId is absent from query", async () => {
      const req = createMockReq("GET", {});
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Valid order ID is required",
            code: "VALIDATION_ERROR",
          }),
        })
      );
      expect(getAnOrder).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Empty orderId
  // -----------------------------------------------------------------------
  describe("empty orderId", () => {
    it("returns a ValidationError (400) when orderId is an empty string", async () => {
      const req = createMockReq("GET", { orderId: "" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Valid order ID is required",
            code: "VALIDATION_ERROR",
          }),
        })
      );
      expect(getAnOrder).not.toHaveBeenCalled();
    });

    it("returns a ValidationError (400) when orderId is not a string", async () => {
      const req = createMockReq("GET", { orderId: 12345 });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(getAnOrder).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Order not found (EP returns no data)
  // -----------------------------------------------------------------------
  describe("order not found", () => {
    it("returns an OrderError when getAnOrder response has no data", async () => {
      (getAnOrder as jest.Mock).mockResolvedValue({ data: { data: null } });

      const req = createMockReq("GET", { orderId: "missing-order" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Order not found",
            code: "ORDER_ERROR",
          }),
        })
      );
    });

    it("returns an OrderError when getAnOrder response.data is undefined", async () => {
      (getAnOrder as jest.Mock).mockResolvedValue({ data: undefined });

      const req = createMockReq("GET", { orderId: "missing-order" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Order not found",
            code: "ORDER_ERROR",
          }),
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 6. EP API generic error (non-404)
  // -----------------------------------------------------------------------
  describe("Elastic Path API error", () => {
    it("passes generic errors through handleElasticPathError", async () => {
      const apiError = new Error("Something went wrong with EP");
      (apiError as any).response = { status: 500 };
      (getAnOrder as jest.Mock).mockRejectedValue(apiError);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      // handleElasticPathError should have been called with the original error
      expect(handleElasticPathError).toHaveBeenCalledWith(apiError);

      // logError should be called
      expect(logError).toHaveBeenCalledWith(
        expect.any(CheckoutError),
        expect.objectContaining({
          endpoint: "get-order",
          orderId: "order-001",
        })
      );

      // getHttpStatusForError determines the status code
      expect(getHttpStatusForError).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 7. EP 404 error — converted to OrderError
  // -----------------------------------------------------------------------
  describe("Elastic Path 404 error", () => {
    it("converts EP 404 responses to an OrderError", async () => {
      const notFoundError = new Error("Not Found");
      (notFoundError as any).response = { status: 404 };
      (getAnOrder as jest.Mock).mockRejectedValue(notFoundError);

      const req = createMockReq("GET", { orderId: "order-999" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      // handleElasticPathError is called first (generic path)
      expect(handleElasticPathError).toHaveBeenCalledWith(notFoundError);

      // Then the 404 branch overrides with OrderError
      // logError receives an OrderError
      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "ORDER_ERROR",
          message: "Order not found",
        }),
        expect.objectContaining({
          endpoint: "get-order",
          orderId: "order-999",
        })
      );

      // Status code should be 404 via getHttpStatusForError
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Order not found",
            code: "ORDER_ERROR",
          }),
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // 8. Environment validation failure
  // -----------------------------------------------------------------------
  describe("environment validation failure", () => {
    it("propagates the error when validateEnvironmentVariables throws", async () => {
      const envError = new ValidationError("Missing EP_CLIENT_ID");
      (validateEnvironmentVariables as jest.Mock).mockImplementation(() => {
        throw envError;
      });

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      // Since envError is a CheckoutError (via ValidationError), it should
      // pass through the instanceof CheckoutError branch untouched
      expect(handleElasticPathError).not.toHaveBeenCalled();

      expect(logError).toHaveBeenCalledWith(
        envError,
        expect.objectContaining({ endpoint: "get-order" })
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Missing EP_CLIENT_ID",
            code: "VALIDATION_ERROR",
          }),
        })
      );

      // getAnOrder should never have been called
      expect(getAnOrder).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge-case coverage
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles CheckoutError thrown directly (passthrough, no handleElasticPathError)", async () => {
      const directError = new CheckoutError(
        "Custom checkout error",
        "CUSTOM_CODE",
        { extra: true }
      );
      (getAnOrder as jest.Mock).mockRejectedValue(directError);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      // CheckoutError passthrough — handleElasticPathError should NOT be called
      expect(handleElasticPathError).not.toHaveBeenCalled();

      expect(logError).toHaveBeenCalledWith(
        directError,
        expect.objectContaining({ endpoint: "get-order" })
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Custom checkout error",
            code: "CUSTOM_CODE",
          }),
        })
      );
    });

    it("handles an error without a response property gracefully", async () => {
      const plainError = new Error("Network timeout");
      (getAnOrder as jest.Mock).mockRejectedValue(plainError);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      // Should go through handleElasticPathError (not a CheckoutError)
      expect(handleElasticPathError).toHaveBeenCalledWith(plainError);

      // Should not throw accessing error.response?.status
      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it("uses default host when EP_HOST is not set", async () => {
      delete process.env.EP_HOST;
      const epResponse = buildEpOrderResponse();
      (getAnOrder as jest.Mock).mockResolvedValue(epResponse);

      const req = createMockReq("GET", { orderId: "order-001" });
      const res = createMockRes();

      await getOrderHandler(req, res);

      expect(getAnOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          client: expect.objectContaining({
            settings: expect.objectContaining({
              host: "https://api.moltin.com",
            }),
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
