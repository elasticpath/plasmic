/**
 * Tests for confirm-payment endpoint handler
 *
 * Covers:
 *  - HTTP method validation
 *  - Request body validation (orderId, transactionId, stripePaymentIntentId)
 *  - ID format validation (non-empty strings, pi_ prefix)
 *  - Stripe PaymentIntent retrieval and status checks
 *  - Metadata order_id matching
 *  - Elastic Path confirmPayment call with correct data
 *  - Success response with transformed order
 *  - Order/payment status mapping (transformElasticPathOrder internals)
 *  - Post-payment action handling
 *  - Error paths (missing data from EP, Stripe errors, etc.)
 */

// ---------------------------------------------------------------------------
// Mocks – must be declared before `require()` of the handler
// ---------------------------------------------------------------------------

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  confirmPayment: jest.fn(),
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

const { confirmPayment } = require("@epcc-sdk/sdks-shopper");
const {
  validateEnvironmentVariables,
} = require("../../../utils/validation");

// Import handler after mocks are registered
const confirmPaymentHandler = require("../confirm-payment").default;

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

/** Builds a complete EP order object suitable for the transform function. */
function buildEpOrder(overrides: Record<string, any> = {}) {
  return {
    id: "ep-order-001",
    status: "complete",
    payment: "paid",
    meta: {
      display_price: {
        with_tax: { amount: 5999, currency: "USD" },
        without_tax: { amount: 4999, currency: "USD" },
        tax: { amount: 1000, currency: "USD" },
      },
    },
    customer: { name: "Jane Doe", email: "jane@example.com" },
    billing_address: {
      first_name: "Jane",
      last_name: "Doe",
      line_1: "123 Main St",
      city: "Springfield",
      country: "US",
      postcode: "12345",
    },
    shipping_address: null,
    relationships: { items: { data: [{ type: "item", id: "item-1" }] } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("confirmPaymentHandler", () => {
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

  it("returns 405 for non-POST requests (GET)", async () => {
    const req = createMockReq("GET", {});
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: "Method not allowed" }),
      })
    );
  });

  it("returns 405 for DELETE requests", async () => {
    const req = createMockReq("DELETE", {});
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  // -----------------------------------------------------------------------
  // 2. Body validation – missing required fields
  // -----------------------------------------------------------------------

  it("returns error when orderId is missing", async () => {
    const req = createMockReq("POST", {
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_abc",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

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

  it("returns error when transactionId is missing", async () => {
    const req = createMockReq("POST", {
      orderId: "order-1",
      stripePaymentIntentId: "pi_abc",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("transactionId"),
        }),
      })
    );
  });

  it("returns error when stripePaymentIntentId is missing", async () => {
    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "txn-1",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("stripePaymentIntentId"),
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 3. ID format validation
  // -----------------------------------------------------------------------

  it("returns validation error for empty orderId", async () => {
    const req = createMockReq("POST", {
      orderId: "",
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_abc",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

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

  it("returns validation error for empty transactionId", async () => {
    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "",
      stripePaymentIntentId: "pi_abc",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Valid transaction ID is required",
        }),
      })
    );
  });

  it("returns validation error when stripePaymentIntentId does not start with 'pi_'", async () => {
    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "txn-1",
      stripePaymentIntentId: "invalid_id_no_prefix",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Valid Stripe payment intent ID is required",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 4. Stripe PaymentIntent retrieval
  // -----------------------------------------------------------------------

  it("returns error when Stripe PaymentIntent is not found (null)", async () => {
    mockStripeRetrieve.mockResolvedValueOnce(null);

    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_not_found",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Payment intent not found",
        }),
      })
    );
  });

  it("returns error when Stripe retrieve throws", async () => {
    const stripeError: any = new Error("Stripe network error");
    stripeError.type = "StripeAPIError";
    mockStripeRetrieve.mockRejectedValueOnce(stripeError);

    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_stripe_err",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  // -----------------------------------------------------------------------
  // 5. Payment status checks
  // -----------------------------------------------------------------------

  it("returns error when PaymentIntent status is not 'succeeded'", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_pending",
      status: "requires_payment_method",
      metadata: { order_id: "order-1" },
    });

    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_pending",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("Payment not completed"),
        }),
      })
    );
  });

  it("includes the actual status in the error when payment not succeeded", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_processing",
      status: "processing",
      metadata: { order_id: "order-1" },
    });

    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_processing",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining("processing"),
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 6. Metadata order_id matching
  // -----------------------------------------------------------------------

  it("returns error when metadata.order_id does not match orderId", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_mismatch",
      status: "succeeded",
      metadata: { order_id: "different-order-999" },
      amount: 5000,
      currency: "usd",
      latest_charge: "ch_abc",
    });

    const req = createMockReq("POST", {
      orderId: "order-1",
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_mismatch",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Payment intent does not match order",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 7. EP confirmPayment call
  // -----------------------------------------------------------------------

  it("calls EP confirmPayment with correct data", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_confirm_ok",
      status: "succeeded",
      metadata: { order_id: "order-ep-1" },
      amount: 7500,
      currency: "usd",
      latest_charge: "ch_charge_1",
    });

    confirmPayment.mockResolvedValueOnce({
      data: { data: buildEpOrder({ id: "order-ep-1" }) },
    });

    const req = createMockReq("POST", {
      orderId: "order-ep-1",
      transactionId: "txn-ep-1",
      stripePaymentIntentId: "pi_confirm_ok",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { orderID: "order-ep-1", transactionID: "txn-ep-1" },
        body: {
          data: expect.objectContaining({
            gateway: "stripe",
            payment_intent_id: "pi_confirm_ok",
            status: "paid",
            amount: 7500,
            currency: "usd",
          }),
        },
      })
    );
  });

  // -----------------------------------------------------------------------
  // 8. Success response
  // -----------------------------------------------------------------------

  it("returns 200 with transformed order on success", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_success",
      status: "succeeded",
      metadata: { order_id: "order-success-1" },
      amount: 5999,
      currency: "usd",
      latest_charge: "ch_123",
    });

    confirmPayment.mockResolvedValueOnce({
      data: { data: buildEpOrder({ id: "order-success-1" }) },
    });

    const req = createMockReq("POST", {
      orderId: "order-success-1",
      transactionId: "txn-success-1",
      stripePaymentIntentId: "pi_success",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          order: expect.objectContaining({
            id: "order-success-1",
            type: "order",
          }),
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 9. Order transformation – status mapping
  // -----------------------------------------------------------------------

  it("transforms EP order response correctly (complete -> complete, paid -> paid)", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_transform",
      status: "succeeded",
      metadata: { order_id: "order-transform" },
      amount: 1000,
      currency: "usd",
      latest_charge: "ch_tx",
    });

    const epOrder = buildEpOrder({
      id: "order-transform",
      status: "complete",
      payment: "paid",
    });

    confirmPayment.mockResolvedValueOnce({
      data: { data: epOrder },
    });

    const req = createMockReq("POST", {
      orderId: "order-transform",
      transactionId: "txn-transform",
      stripePaymentIntentId: "pi_transform",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    const responseOrder = res.json.mock.calls[0][0].data.order;
    expect(responseOrder.status).toBe("complete");
    expect(responseOrder.payment).toBe("paid");
    expect(responseOrder.total).toEqual({ amount: 5999, currency: "USD" });
    expect(responseOrder.subtotal).toEqual({ amount: 4999, currency: "USD" });
    expect(responseOrder.tax).toEqual({ amount: 1000, currency: "USD" });
  });

  // -----------------------------------------------------------------------
  // 10. Handles missing order data from EP
  // -----------------------------------------------------------------------

  it("returns PaymentError when EP confirmPayment returns no data", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_no_ep_data",
      status: "succeeded",
      metadata: { order_id: "order-no-ep" },
      amount: 2000,
      currency: "usd",
      latest_charge: "ch_no_ep",
    });

    confirmPayment.mockResolvedValueOnce({ data: null });

    const req = createMockReq("POST", {
      orderId: "order-no-ep",
      transactionId: "txn-no-ep",
      stripePaymentIntentId: "pi_no_ep_data",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Failed to confirm payment with Elastic Path",
        }),
      })
    );
  });

  it("returns PaymentError when EP confirmPayment returns empty data.data", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_empty_ep",
      status: "succeeded",
      metadata: { order_id: "order-empty-ep" },
      amount: 3000,
      currency: "usd",
      latest_charge: "ch_empty_ep",
    });

    confirmPayment.mockResolvedValueOnce({
      data: { data: null },
    });

    const req = createMockReq("POST", {
      orderId: "order-empty-ep",
      transactionId: "txn-empty-ep",
      stripePaymentIntentId: "pi_empty_ep",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: "Failed to confirm payment with Elastic Path",
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // 11. Payment status mapping
  // -----------------------------------------------------------------------

  describe("mapPaymentStatus", () => {
    const paymentStatusCases: Array<[string, string]> = [
      ["pending", "pending"],
      ["authorized", "authorized"],
      ["paid", "paid"],
      ["complete", "paid"],       // 'complete' maps to 'paid'
      ["cancelled", "cancelled"],
      ["failed", "failed"],
      ["refunded", "refunded"],
    ];

    it.each(paymentStatusCases)(
      "maps EP payment status '%s' to '%s'",
      async (epPayment, expectedPayment) => {
        mockStripeRetrieve.mockResolvedValueOnce({
          id: `pi_pay_${epPayment}`,
          status: "succeeded",
          metadata: { order_id: `order-pay-${epPayment}` },
          amount: 1000,
          currency: "usd",
          latest_charge: "ch_p",
        });

        const epOrder = buildEpOrder({
          id: `order-pay-${epPayment}`,
          status: "complete",
          payment: epPayment,
        });

        confirmPayment.mockResolvedValueOnce({
          data: { data: epOrder },
        });

        const req = createMockReq("POST", {
          orderId: `order-pay-${epPayment}`,
          transactionId: `txn-pay-${epPayment}`,
          stripePaymentIntentId: `pi_pay_${epPayment}`,
        });
        const res = createMockRes();

        await confirmPaymentHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const responseOrder = res.json.mock.calls[0][0].data.order;
        expect(responseOrder.payment).toBe(expectedPayment);
      }
    );
  });

  // -----------------------------------------------------------------------
  // 12. Order status mapping
  // -----------------------------------------------------------------------

  describe("mapElasticPathStatus", () => {
    const orderStatusCases: Array<[string, string]> = [
      ["incomplete", "incomplete"],
      ["processing", "processing"],
      ["complete", "complete"],
      ["cancelled", "cancelled"],
      ["unknown_status", "incomplete"],   // unmapped -> 'incomplete'
    ];

    it.each(orderStatusCases)(
      "maps EP order status '%s' to '%s'",
      async (epStatus, expectedStatus) => {
        mockStripeRetrieve.mockResolvedValueOnce({
          id: `pi_os_${epStatus}`,
          status: "succeeded",
          metadata: { order_id: `order-os-${epStatus}` },
          amount: 2000,
          currency: "usd",
          latest_charge: "ch_os",
        });

        const epOrder = buildEpOrder({
          id: `order-os-${epStatus}`,
          status: epStatus,
          payment: "paid",
        });

        confirmPayment.mockResolvedValueOnce({
          data: { data: epOrder },
        });

        const req = createMockReq("POST", {
          orderId: `order-os-${epStatus}`,
          transactionId: `txn-os-${epStatus}`,
          stripePaymentIntentId: `pi_os_${epStatus}`,
        });
        const res = createMockRes();

        await confirmPaymentHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const responseOrder = res.json.mock.calls[0][0].data.order;
        expect(responseOrder.status).toBe(expectedStatus);
      }
    );
  });

  // -----------------------------------------------------------------------
  // 13. Post-payment actions do not break the flow
  // -----------------------------------------------------------------------

  it("returns success even when post-payment actions execute (handler is resilient)", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_post_act",
      status: "succeeded",
      metadata: { order_id: "order-post-act" },
      amount: 4000,
      currency: "usd",
      latest_charge: "ch_post",
    });

    confirmPayment.mockResolvedValueOnce({
      data: { data: buildEpOrder({ id: "order-post-act" }) },
    });

    const req = createMockReq("POST", {
      orderId: "order-post-act",
      transactionId: "txn-post-act",
      stripePaymentIntentId: "pi_post_act",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  // -----------------------------------------------------------------------
  // 14. Null / missing body
  // -----------------------------------------------------------------------

  it("returns error when request body is null", async () => {
    const req = createMockReq("POST", null);
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

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
  // 15. EP confirmPayment throws
  // -----------------------------------------------------------------------

  it("handles EP confirmPayment throwing an error", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_ep_throw",
      status: "succeeded",
      metadata: { order_id: "order-ep-throw" },
      amount: 5000,
      currency: "usd",
      latest_charge: "ch_throw",
    });

    confirmPayment.mockRejectedValueOnce(
      new Error("EP service unavailable")
    );

    const req = createMockReq("POST", {
      orderId: "order-ep-throw",
      transactionId: "txn-ep-throw",
      stripePaymentIntentId: "pi_ep_throw",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  // -----------------------------------------------------------------------
  // 16. Confirmation metadata includes stripe_payment_intent_id
  // -----------------------------------------------------------------------

  it("sends metadata with stripe_payment_intent_id in EP confirmation data", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_meta_check",
      status: "succeeded",
      metadata: { order_id: "order-meta" },
      amount: 6000,
      currency: "gbp",
      latest_charge: "ch_meta",
    });

    confirmPayment.mockResolvedValueOnce({
      data: { data: buildEpOrder({ id: "order-meta" }) },
    });

    const req = createMockReq("POST", {
      orderId: "order-meta",
      transactionId: "txn-meta",
      stripePaymentIntentId: "pi_meta_check",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    const callArgs = confirmPayment.mock.calls[0][0];
    expect(callArgs.body.data.metadata).toEqual(
      expect.objectContaining({
        stripe_payment_intent_id: "pi_meta_check",
        stripe_charge_id: "ch_meta",
      })
    );
  });

  // -----------------------------------------------------------------------
  // 17. Transformed order includes customer and addresses
  // -----------------------------------------------------------------------

  it("includes customer and billing_address in the transformed order", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_cust_addr",
      status: "succeeded",
      metadata: { order_id: "order-cust" },
      amount: 8000,
      currency: "usd",
      latest_charge: "ch_cust",
    });

    const epOrder = buildEpOrder({
      id: "order-cust",
      customer: { name: "John Smith", email: "john@example.com" },
      billing_address: {
        first_name: "John",
        last_name: "Smith",
        line_1: "456 Oak Ave",
        city: "Portland",
        country: "US",
        postcode: "97201",
      },
    });

    confirmPayment.mockResolvedValueOnce({
      data: { data: epOrder },
    });

    const req = createMockReq("POST", {
      orderId: "order-cust",
      transactionId: "txn-cust",
      stripePaymentIntentId: "pi_cust_addr",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseOrder = res.json.mock.calls[0][0].data.order;
    expect(responseOrder.customer).toEqual({
      name: "John Smith",
      email: "john@example.com",
    });
    expect(responseOrder.billing_address).toEqual(
      expect.objectContaining({
        first_name: "John",
        last_name: "Smith",
        line_1: "456 Oak Ave",
      })
    );
  });

  // -----------------------------------------------------------------------
  // 18. Transformed order handles missing optional fields
  // -----------------------------------------------------------------------

  it("handles EP order with no customer, no shipping, and no meta gracefully", async () => {
    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_minimal",
      status: "succeeded",
      metadata: { order_id: "order-minimal" },
      amount: 500,
      currency: "usd",
      latest_charge: "ch_minimal",
    });

    const minimalOrder = {
      id: "order-minimal",
      status: "incomplete",
      payment: undefined,
      meta: undefined,
      customer: undefined,
      billing_address: undefined,
      shipping_address: undefined,
      shipping: undefined,
      relationships: undefined,
    };

    confirmPayment.mockResolvedValueOnce({
      data: { data: minimalOrder },
    });

    const req = createMockReq("POST", {
      orderId: "order-minimal",
      transactionId: "txn-minimal",
      stripePaymentIntentId: "pi_minimal",
    });
    const res = createMockRes();

    await confirmPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseOrder = res.json.mock.calls[0][0].data.order;
    expect(responseOrder.id).toBe("order-minimal");
    expect(responseOrder.total).toEqual({ amount: 0, currency: "USD" });
    expect(responseOrder.customer).toBeUndefined();
    expect(responseOrder.shipping).toBeUndefined();
  });
});
