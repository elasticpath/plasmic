/**
 * Tests for setup-payment endpoint handler
 *
 * Covers:
 *  - HTTP method validation
 *  - Request body validation (orderId, amount, currency, gateway)
 *  - Order amount validation
 *  - orderId format validation
 *  - Gateway validation (only 'stripe' supported)
 *  - Amount-to-cents conversion and minimum amount check
 *  - Stripe PaymentIntent creation with correct params
 *  - Elastic Path paymentSetup call
 *  - Success response shape
 *  - Stripe intent cancellation on EP failure
 *  - Error handling (missing client_secret, Stripe errors, EP errors)
 */

// ---------------------------------------------------------------------------
// Mocks – must be declared before `require()` of the handler
// ---------------------------------------------------------------------------

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  paymentSetup: jest.fn(),
}));

const mockStripeCreate = jest.fn();
const mockStripeRetrieve = jest.fn();
const mockStripeCancel = jest.fn();

jest.mock("stripe", () => {
  const StripeMock = jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockStripeCreate,
      retrieve: mockStripeRetrieve,
      cancel: mockStripeCancel,
    },
  }));
  return { __esModule: true, default: StripeMock };
}, { virtual: true });

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
  toCents: jest.fn((amount: number) => Math.round(amount * 100)),
}));

jest.mock("../../../utils/validation", () => ({
  validateOrderAmount: jest.fn(() => ({ isValid: true, errors: {} })),
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
  class PaymentError extends CheckoutError {
    constructor(msg: string, details?: any) {
      super(msg, "PAYMENT_ERROR", details);
      this.name = "PaymentError";
    }
  }
  return {
    CheckoutError,
    ValidationError,
    PaymentError,
    handleElasticPathError: jest.fn(
      (err: any) => new CheckoutError(err?.message || "EP error")
    ),
    handleStripeError: jest.fn(
      (err: any) => new CheckoutError(err?.message || "Stripe error")
    ),
    logError: jest.fn(),
    getHttpStatusForError: jest.fn((err: any) => {
      if (err.code === "VALIDATION_ERROR") return 400;
      if (err.code === "PAYMENT_ERROR") return 402;
      return 500;
    }),
  };
});

// ---------------------------------------------------------------------------
// Use require() to obtain mocked module references after jest.mock()
// ---------------------------------------------------------------------------

const { paymentSetup } = require("@epcc-sdk/sdks-shopper");
const {
  validateOrderAmount,
  validateEnvironmentVariables,
} = require("../../../utils/validation");
const {
  createSuccessResponse,
  createErrorResponse,
} = require("../../../utils/api-helpers");

// Import handler after mocks are registered
const setupPaymentHandler = require("../setup-payment").default;

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("setupPaymentHandler", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeAll(() => {
    envBackup.EP_CLIENT_ID = process.env.EP_CLIENT_ID;
    envBackup.EP_HOST = process.env.EP_HOST;
    envBackup.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    envBackup.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;
  });

  afterAll(() => {
    Object.entries(envBackup).forEach(([key, val]) => {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.EP_CLIENT_ID = "test-client-id";
    process.env.EP_HOST = "https://api.test.com";
    process.env.STRIPE_SECRET_KEY = "sk_test_fake123";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_fake456";
  });

  // -----------------------------------------------------------------------
  // 1. Method validation
  // -----------------------------------------------------------------------

  it("returns 405 for non-POST requests", async () => {
    const req = createMockReq("GET", {});
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: "Method not allowed" }),
      })
    );
  });

  it("returns 405 for PUT requests", async () => {
    const req = createMockReq("PUT", {});
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  // -----------------------------------------------------------------------
  // 2. Body validation
  // -----------------------------------------------------------------------

  it("returns error when orderId is missing from request body", async () => {
    const req = createMockReq("POST", { amount: 25.0, currency: "USD" });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("orderId"),
        }),
      })
    );
  });

  it("returns error when amount is missing from request body", async () => {
    const req = createMockReq("POST", {
      orderId: "order-123",
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("amount"),
        }),
      })
    );
  });

  it("returns error when currency is missing from request body", async () => {
    const req = createMockReq("POST", {
      orderId: "order-123",
      amount: 25.0,
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("currency"),
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 3. Order amount validation
  // -----------------------------------------------------------------------

  it("returns validation error when validateOrderAmount reports invalid", async () => {
    validateOrderAmount.mockReturnValueOnce({
      isValid: false,
      errors: { amount: "Order amount must be greater than zero" },
    });

    const req = createMockReq("POST", {
      orderId: "order-123",
      amount: -5,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Invalid order amount",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 4. orderId format validation
  // -----------------------------------------------------------------------

  it("returns validation error for empty orderId", async () => {
    const req = createMockReq("POST", {
      orderId: "",
      amount: 25.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Valid order ID is required",
        }),
      })
    );
  });

  it("returns validation error when orderId is not a string", async () => {
    const req = createMockReq("POST", {
      orderId: 12345,
      amount: 25.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Valid order ID is required",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 5. Gateway validation
  // -----------------------------------------------------------------------

  it("returns validation error for unsupported gateway", async () => {
    const req = createMockReq("POST", {
      orderId: "order-123",
      amount: 25.0,
      currency: "USD",
      gateway: "paypal",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("Unsupported payment gateway"),
        }),
      })
    );
  });

  it("defaults gateway to 'stripe' when not provided", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_test_123",
      client_secret: "pi_test_123_secret_abc",
    });

    paymentSetup.mockResolvedValueOnce({
      data: { data: { id: "txn-001" } },
    });

    const req = createMockReq("POST", {
      orderId: "order-123",
      amount: 25.0,
      currency: "USD",
      // gateway intentionally omitted
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    // If gateway defaulted to 'stripe' we should reach success
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // -----------------------------------------------------------------------
  // 6. Minimum amount validation
  // -----------------------------------------------------------------------

  it("returns validation error when amount is less than $0.50 (< 50 cents)", async () => {
    const req = createMockReq("POST", {
      orderId: "order-123",
      amount: 0.49,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("at least $0.50"),
        }),
      })
    );
  });

  it("accepts amount exactly $0.50 (50 cents)", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_test_min",
      client_secret: "pi_test_min_secret",
    });

    paymentSetup.mockResolvedValueOnce({
      data: { data: { id: "txn-min" } },
    });

    const req = createMockReq("POST", {
      orderId: "order-min",
      amount: 0.5,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  // -----------------------------------------------------------------------
  // 7. Stripe PaymentIntent creation
  // -----------------------------------------------------------------------

  it("creates Stripe PaymentIntent with correct params (cents, lowercase currency, metadata)", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_test_abc",
      client_secret: "pi_test_abc_secret_xyz",
    });

    paymentSetup.mockResolvedValueOnce({
      data: { data: { id: "txn-100" } },
    });

    const req = createMockReq("POST", {
      orderId: "order-456",
      amount: 42.99,
      currency: "EUR",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(mockStripeCreate).toHaveBeenCalledWith({
      amount: 4299,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      metadata: {
        order_id: "order-456",
        source: "elastic-path-checkout",
      },
    });
  });

  // -----------------------------------------------------------------------
  // 8. Elastic Path paymentSetup call
  // -----------------------------------------------------------------------

  it("calls EP paymentSetup with correct payment data", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_ep_test",
      client_secret: "pi_ep_test_secret",
    });

    paymentSetup.mockResolvedValueOnce({
      data: { data: { id: "txn-ep" } },
    });

    const req = createMockReq("POST", {
      orderId: "order-789",
      amount: 100.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(paymentSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { orderID: "order-789" },
        body: {
          data: {
            gateway: "stripe",
            method: "card",
            amount: 10000,
            currency: "usd",
            payment_intent_id: "pi_ep_test",
            client_secret: "pi_ep_test_secret",
          },
        },
      })
    );
  });

  // -----------------------------------------------------------------------
  // 9. Success response
  // -----------------------------------------------------------------------

  it("returns 200 with clientSecret, transactionId, paymentIntentId on success", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_success_1",
      client_secret: "pi_success_1_secret_999",
    });

    paymentSetup.mockResolvedValueOnce({
      data: { data: { id: "txn-success-1" } },
    });

    const req = createMockReq("POST", {
      orderId: "order-s1",
      amount: 59.99,
      currency: "GBP",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          clientSecret: "pi_success_1_secret_999",
          transactionId: "txn-success-1",
          paymentIntentId: "pi_success_1",
        },
      })
    );
  });

  // -----------------------------------------------------------------------
  // 10. EP failure -> cancel Stripe PaymentIntent
  // -----------------------------------------------------------------------

  it("cancels Stripe PaymentIntent when EP paymentSetup fails (no data)", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_cancel_me",
      client_secret: "pi_cancel_me_secret",
    });

    paymentSetup.mockResolvedValueOnce({
      data: null,
    });

    mockStripeCancel.mockResolvedValueOnce({});

    const req = createMockReq("POST", {
      orderId: "order-fail",
      amount: 10.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(mockStripeCancel).toHaveBeenCalledWith("pi_cancel_me");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Failed to setup payment with Elastic Path",
        }),
      })
    );
  });

  it("cancels Stripe PaymentIntent when EP paymentSetup returns empty data.data", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_cancel_me_2",
      client_secret: "pi_cancel_me_2_secret",
    });

    paymentSetup.mockResolvedValueOnce({
      data: { data: null },
    });

    mockStripeCancel.mockResolvedValueOnce({});

    const req = createMockReq("POST", {
      orderId: "order-fail-2",
      amount: 15.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(mockStripeCancel).toHaveBeenCalledWith("pi_cancel_me_2");
  });

  // -----------------------------------------------------------------------
  // 11. Missing client_secret from Stripe
  // -----------------------------------------------------------------------

  it("returns PaymentError when Stripe response has no client_secret", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_no_secret",
      client_secret: null,
    });

    const req = createMockReq("POST", {
      orderId: "order-no-secret",
      amount: 20.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Failed to create payment intent",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 12. Stripe errors
  // -----------------------------------------------------------------------

  it("handles Stripe PaymentIntent creation errors", async () => {
    const stripeError: any = new Error("Card declined");
    stripeError.type = "StripeCardError";
    mockStripeCreate.mockRejectedValueOnce(stripeError);

    const req = createMockReq("POST", {
      orderId: "order-stripe-err",
      amount: 30.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.any(String),
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 13. EP paymentSetup throws
  // -----------------------------------------------------------------------

  it("handles EP paymentSetup throwing an error", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_ep_throw",
      client_secret: "pi_ep_throw_secret",
    });

    paymentSetup.mockRejectedValueOnce(
      new Error("EP network error")
    );

    const req = createMockReq("POST", {
      orderId: "order-ep-throw",
      amount: 50.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      })
    );
  });

  // -----------------------------------------------------------------------
  // 14. Null request body
  // -----------------------------------------------------------------------

  it("returns error when request body is null", async () => {
    const req = createMockReq("POST", null);
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("Request body is required"),
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 15. Calls validateEnvironmentVariables on every request
  // -----------------------------------------------------------------------

  it("calls validateEnvironmentVariables on every request", async () => {
    const req = createMockReq("GET", {});
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(validateEnvironmentVariables).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 16. Returns error if validateEnvironmentVariables throws
  // -----------------------------------------------------------------------

  it("returns error if validateEnvironmentVariables throws", async () => {
    validateEnvironmentVariables.mockImplementationOnce(() => {
      throw new Error("Missing required environment variables: STRIPE_SECRET_KEY");
    });

    const req = createMockReq("POST", {
      orderId: "order-env",
      amount: 25.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  // -----------------------------------------------------------------------
  // 17. Stripe cancel failure is handled gracefully (EP still fails)
  // -----------------------------------------------------------------------

  it("still returns EP failure even if Stripe cancel also fails", async () => {
    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_cancel_fail",
      client_secret: "pi_cancel_fail_secret",
    });

    paymentSetup.mockResolvedValueOnce({
      data: null,
    });

    mockStripeCancel.mockRejectedValueOnce(new Error("Cancel network error"));

    const req = createMockReq("POST", {
      orderId: "order-cancel-fail",
      amount: 10.0,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    // Should still return the EP setup failure error
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Failed to setup payment with Elastic Path",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 18. toCents is called with the correct amount
  // -----------------------------------------------------------------------

  it("converts amount to cents via toCents before Stripe and EP calls", async () => {
    const { toCents } = require("../../../utils/api-helpers");

    mockStripeCreate.mockResolvedValueOnce({
      id: "pi_cents",
      client_secret: "pi_cents_secret",
    });

    paymentSetup.mockResolvedValueOnce({
      data: { data: { id: "txn-cents" } },
    });

    const req = createMockReq("POST", {
      orderId: "order-cents",
      amount: 19.99,
      currency: "USD",
    });
    const res = createMockRes();

    await setupPaymentHandler(req, res);

    expect(toCents).toHaveBeenCalledWith(19.99);
    // Stripe should receive 1999 cents
    expect(mockStripeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1999 })
    );
  });
});
