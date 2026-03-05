jest.mock("@epcc-sdk/sdks-shopper", () => ({
  checkoutApi: jest.fn(),
}));

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
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
  validateRequestBody: jest.fn((req: any, fields: string[]) => {
    if (!req.body) throw new Error("Request body is required");
    const missing = fields.filter((f: string) => !(f in req.body));
    if (missing.length > 0)
      throw new Error(`Missing required fields: ${missing.join(", ")}`);
    return req.body;
  }),
}));

jest.mock("../../../utils/validation", () => ({
  validateCheckoutForm: jest.fn(() => ({ isValid: true, errors: {} })),
  sanitizeCustomerData: jest.fn((d: any) => d),
  sanitizeAddressData: jest.fn((d: any) => d),
  validateEnvironmentVariables: jest.fn(),
}));

jest.mock("../../../utils/error-handling", () => {
  class CheckoutError extends Error {
    code: string;
    details?: any;
    constructor(msg: string, code = "CHECKOUT_ERROR", details?: any) {
      super(msg);
      this.name = "CheckoutError";
      this.code = code;
      this.details = details;
    }
  }

  class ValidationError extends CheckoutError {
    constructor(msg: string, details?: any) {
      super(msg, "VALIDATION_ERROR", details);
      this.name = "ValidationError";
    }
  }

  return {
    CheckoutError,
    ValidationError,
    PaymentError: class extends CheckoutError {
      constructor(msg: string, details?: any) {
        super(msg, "PAYMENT_ERROR", details);
        this.name = "PaymentError";
      }
    },
    handleElasticPathError: jest.fn(
      (err: any) => new CheckoutError(err?.message || "EP error")
    ),
    logError: jest.fn(),
    getHttpStatusForError: jest.fn((err: any) => {
      if (err.code === "VALIDATION_ERROR") return 400;
      return 500;
    }),
  };
});

// Use require() to obtain mocked module references after jest.mock() registration
const { checkoutApi } = require("@epcc-sdk/sdks-shopper");
const {
  validateCheckoutForm,
  sanitizeCustomerData,
  sanitizeAddressData,
  validateEnvironmentVariables,
} = require("../../../utils/validation");
const {
  createSuccessResponse,
  createErrorResponse,
} = require("../../../utils/api-helpers");
const {
  handleElasticPathError,
  getHttpStatusForError,
} = require("../../../utils/error-handling");

// Import handler after mocks are registered
const createOrderHandler = require("../create-order").default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockReq(method: string, body: any) {
  return { method, body };
}

function createMockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function validCustomerData() {
  return {
    name: "Jane Doe",
    email: "jane@example.com",
  };
}

function validBillingAddress() {
  return {
    first_name: "Jane",
    last_name: "Doe",
    line_1: "123 Main St",
    line_2: "Apt 4",
    city: "Portland",
    county: "OR",
    postcode: "97201",
    country: "US",
  };
}

function validShippingAddress() {
  return {
    first_name: "Jane",
    last_name: "Doe",
    line_1: "456 Oak Ave",
    line_2: "",
    city: "Seattle",
    county: "WA",
    postcode: "98101",
    country: "US",
  };
}

function validBody(overrides: Record<string, any> = {}) {
  return {
    cartId: "cart-abc-123",
    customerData: validCustomerData(),
    billingAddress: validBillingAddress(),
    ...overrides,
  };
}

function fullEpOrderResponse(overrides: Record<string, any> = {}) {
  return {
    id: "order-ep-001",
    status: "incomplete",
    payment: "authorized",
    customer: { name: "Jane Doe", email: "jane@example.com" },
    billing_address: {
      first_name: "Jane",
      last_name: "Doe",
      line_1: "123 Main St",
      line_2: "Apt 4",
      city: "Portland",
      county: "OR",
      postcode: "97201",
      country: "US",
      company_name: "Acme Inc",
    },
    shipping_address: {
      first_name: "Jane",
      last_name: "Doe",
      line_1: "456 Oak Ave",
      line_2: "",
      city: "Seattle",
      county: "WA",
      postcode: "98101",
      country: "US",
      company_name: "",
    },
    shipping: { amount: 999, currency: "USD" },
    relationships: { items: { data: [{ id: "item-1", type: "item" }] } },
    meta: {
      display_price: {
        with_tax: { amount: 5999, currency: "USD" },
        without_tax: { amount: 5000, currency: "USD" },
        tax: { amount: 999, currency: "USD" },
      },
    },
    ...overrides,
  };
}

function mockCheckoutApiSuccess(epOrder: any = fullEpOrderResponse()) {
  checkoutApi.mockResolvedValue({
    data: { data: epOrder },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createOrderHandler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      EP_CLIENT_ID: "test-client-id",
      EP_HOST: "https://api.test.moltin.com",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // -----------------------------------------------------------------------
  // HTTP method validation
  // -----------------------------------------------------------------------

  it("returns 405 for GET requests", async () => {
    const req = createMockReq("GET", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(createErrorResponse).toHaveBeenCalledWith("Method not allowed");
  });

  it("returns 405 for PUT requests", async () => {
    const req = createMockReq("PUT", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  // -----------------------------------------------------------------------
  // Missing required fields
  // -----------------------------------------------------------------------

  it("returns error when cartId is missing from body", async () => {
    const body = validBody();
    delete (body as any).cartId;
    const req = createMockReq("POST", body);
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it("returns error when customerData is missing from body", async () => {
    const body = validBody();
    delete (body as any).customerData;
    const req = createMockReq("POST", body);
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it("returns error when billingAddress is missing from body", async () => {
    const body = validBody();
    delete (body as any).billingAddress;
    const req = createMockReq("POST", body);
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it("returns error when body is null", async () => {
    const req = createMockReq("POST", null);
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Validation errors
  // -----------------------------------------------------------------------

  it("returns validation error when validateCheckoutForm fails", async () => {
    validateCheckoutForm.mockReturnValueOnce({
      isValid: false,
      errors: { email: "Invalid email address" },
    });
    getHttpStatusForError.mockReturnValueOnce(400);
    mockCheckoutApiSuccess();

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.success).toBe(false);
  });

  it("returns validation error for empty string cartId", async () => {
    getHttpStatusForError.mockReturnValueOnce(400);

    const req = createMockReq("POST", validBody({ cartId: "" }));
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns validation error for non-string cartId", async () => {
    getHttpStatusForError.mockReturnValueOnce(400);

    const req = createMockReq("POST", validBody({ cartId: 12345 }));
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  // -----------------------------------------------------------------------
  // Sanitization
  // -----------------------------------------------------------------------

  it("sanitizes customer and address data before validation", async () => {
    mockCheckoutApiSuccess();

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(sanitizeCustomerData).toHaveBeenCalledWith(validCustomerData());
    expect(sanitizeAddressData).toHaveBeenCalledWith(validBillingAddress());
    // Sanitization must happen before form validation
    const sanitizeCallOrder =
      sanitizeCustomerData.mock.invocationCallOrder[0];
    const validateCallOrder =
      validateCheckoutForm.mock.invocationCallOrder[0];
    expect(sanitizeCallOrder).toBeLessThan(validateCallOrder);
  });

  it("sanitizes shipping address when provided", async () => {
    const shipping = validShippingAddress();
    mockCheckoutApiSuccess();

    const req = createMockReq(
      "POST",
      validBody({ shippingAddress: shipping })
    );
    const res = createMockRes();

    await createOrderHandler(req, res);

    // sanitizeAddressData called twice: once for billing, once for shipping
    expect(sanitizeAddressData).toHaveBeenCalledTimes(2);
    expect(sanitizeAddressData).toHaveBeenCalledWith(shipping);
  });

  it("does not sanitize shipping address when not provided (sameAsBilling)", async () => {
    mockCheckoutApiSuccess();

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    // Only billing address sanitized
    expect(sanitizeAddressData).toHaveBeenCalledTimes(1);
    expect(validateCheckoutForm).toHaveBeenCalledWith(
      expect.objectContaining({ sameAsBilling: true })
    );
  });

  // -----------------------------------------------------------------------
  // Successful order creation
  // -----------------------------------------------------------------------

  it("creates order with correct Elastic Path request format", async () => {
    mockCheckoutApiSuccess();

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(checkoutApi).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-abc-123" },
        body: {
          data: {
            customer: {
              name: "Jane Doe",
              email: "jane@example.com",
            },
            billing_address: {
              first_name: "Jane",
              last_name: "Doe",
              line_1: "123 Main St",
              line_2: "Apt 4",
              city: "Portland",
              county: "OR",
              postcode: "97201",
              country: "US",
            },
            shipping_address: undefined,
          },
        },
      })
    );
  });

  it("returns 201 with transformed order on success", async () => {
    mockCheckoutApiSuccess();

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(createSuccessResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          id: "order-ep-001",
          type: "order",
        }),
      })
    );
  });

  it("transforms EP order response correctly", async () => {
    mockCheckoutApiSuccess();

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    const successCallArg = createSuccessResponse.mock.calls[0][0];
    const order = successCallArg.order;

    expect(order.id).toBe("order-ep-001");
    expect(order.type).toBe("order");
    expect(order.status).toBe("incomplete");
    expect(order.payment).toBe("authorized");
    expect(order.total).toEqual({ amount: 5999, currency: "USD" });
    expect(order.subtotal).toEqual({ amount: 5000, currency: "USD" });
    expect(order.tax).toEqual({ amount: 999, currency: "USD" });
    expect(order.shipping).toEqual({ amount: 999, currency: "USD" });
    expect(order.customer).toEqual({
      name: "Jane Doe",
      email: "jane@example.com",
    });
    expect(order.relationships).toEqual({
      items: { data: [{ id: "item-1", type: "item" }] },
    });
  });

  // -----------------------------------------------------------------------
  // Shipping address handling
  // -----------------------------------------------------------------------

  it("includes shipping address in checkout data when provided", async () => {
    const shipping = validShippingAddress();
    mockCheckoutApiSuccess();

    const req = createMockReq(
      "POST",
      validBody({ shippingAddress: shipping })
    );
    const res = createMockRes();

    await createOrderHandler(req, res);

    const callArg = checkoutApi.mock.calls[0][0];
    expect(callArg.body.data.shipping_address).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      line_1: "456 Oak Ave",
      line_2: "",
      city: "Seattle",
      county: "WA",
      postcode: "98101",
      country: "US",
    });
  });

  // -----------------------------------------------------------------------
  // Missing display_price / optional fields
  // -----------------------------------------------------------------------

  it("handles missing display_price fields with defaults", async () => {
    const epOrder = fullEpOrderResponse({
      meta: {},
      shipping: undefined,
      customer: undefined,
    });
    mockCheckoutApiSuccess(epOrder);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    const successCallArg = createSuccessResponse.mock.calls[0][0];
    const order = successCallArg.order;

    expect(order.total).toEqual({ amount: 0, currency: "USD" });
    expect(order.subtotal).toEqual({ amount: 0, currency: "USD" });
    expect(order.tax).toEqual({ amount: 0, currency: "USD" });
  });

  it("handles missing shipping in EP response", async () => {
    const epOrder = fullEpOrderResponse({ shipping: undefined });
    mockCheckoutApiSuccess(epOrder);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    const successCallArg = createSuccessResponse.mock.calls[0][0];
    expect(successCallArg.order.shipping).toBeUndefined();
  });

  it("handles missing customer in EP response", async () => {
    const epOrder = fullEpOrderResponse({ customer: undefined });
    mockCheckoutApiSuccess(epOrder);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    const successCallArg = createSuccessResponse.mock.calls[0][0];
    expect(successCallArg.order.customer).toBeUndefined();
  });

  it("defaults relationships to empty items when absent", async () => {
    const epOrder = fullEpOrderResponse({ relationships: undefined });
    mockCheckoutApiSuccess(epOrder);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    const successCallArg = createSuccessResponse.mock.calls[0][0];
    expect(successCallArg.order.relationships).toEqual({
      items: { data: [] },
    });
  });

  // -----------------------------------------------------------------------
  // Status mapping
  // -----------------------------------------------------------------------

  describe("mapElasticPathStatus", () => {
    const knownStatuses = [
      "incomplete",
      "processing",
      "complete",
      "cancelled",
      "partially_authorized",
      "partially_paid",
    ];

    it.each(knownStatuses)(
      "maps EP status '%s' to the same value",
      async (status) => {
        const epOrder = fullEpOrderResponse({ status });
        mockCheckoutApiSuccess(epOrder);

        const req = createMockReq("POST", validBody());
        const res = createMockRes();

        await createOrderHandler(req, res);

        const successCallArg = createSuccessResponse.mock.calls[0][0];
        expect(successCallArg.order.status).toBe(status);
      }
    );

    it("maps unknown EP status to 'incomplete'", async () => {
      const epOrder = fullEpOrderResponse({ status: "unknown" });
      mockCheckoutApiSuccess(epOrder);

      const req = createMockReq("POST", validBody());
      const res = createMockRes();

      await createOrderHandler(req, res);

      const successCallArg = createSuccessResponse.mock.calls[0][0];
      expect(successCallArg.order.status).toBe("incomplete");
    });

    it("maps undefined EP status to 'incomplete'", async () => {
      const epOrder = fullEpOrderResponse({ status: undefined });
      mockCheckoutApiSuccess(epOrder);

      const req = createMockReq("POST", validBody());
      const res = createMockRes();

      await createOrderHandler(req, res);

      const successCallArg = createSuccessResponse.mock.calls[0][0];
      expect(successCallArg.order.status).toBe("incomplete");
    });
  });

  // -----------------------------------------------------------------------
  // Error scenarios
  // -----------------------------------------------------------------------

  it("returns error when checkoutApi returns no data", async () => {
    checkoutApi.mockResolvedValue({ data: null });
    getHttpStatusForError.mockReturnValueOnce(500);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(createErrorResponse).toHaveBeenCalledWith(
      "Failed to create order from cart",
      "CHECKOUT_ERROR",
      undefined
    );
  });

  it("returns error when checkoutApi returns data without nested data", async () => {
    checkoutApi.mockResolvedValue({ data: { data: null } });
    getHttpStatusForError.mockReturnValueOnce(500);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(createErrorResponse).toHaveBeenCalledWith(
      "Failed to create order from cart",
      "CHECKOUT_ERROR",
      undefined
    );
  });

  it("handles EP API errors via handleElasticPathError", async () => {
    const apiError = new Error("Network timeout");
    checkoutApi.mockRejectedValue(apiError);
    getHttpStatusForError.mockReturnValueOnce(500);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(handleElasticPathError).toHaveBeenCalledWith(apiError);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("calls validateEnvironmentVariables on every request", async () => {
    mockCheckoutApiSuccess();

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(validateEnvironmentVariables).toHaveBeenCalled();
  });

  it("returns error if validateEnvironmentVariables throws", async () => {
    validateEnvironmentVariables.mockImplementationOnce(() => {
      throw new Error("Missing EP_CLIENT_ID");
    });
    getHttpStatusForError.mockReturnValueOnce(500);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    expect(handleElasticPathError).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("defaults payment to 'pending' when EP order has no payment field", async () => {
    const epOrder = fullEpOrderResponse({ payment: undefined });
    mockCheckoutApiSuccess(epOrder);

    const req = createMockReq("POST", validBody());
    const res = createMockRes();

    await createOrderHandler(req, res);

    const successCallArg = createSuccessResponse.mock.calls[0][0];
    expect(successCallArg.order.payment).toBe("pending");
  });
});
