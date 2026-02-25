// Mock external dependencies before any imports
jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getShippingOptions: jest.fn(),
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
  toCents: jest.fn((amount: number) => Math.round(amount * 100)),
}));

jest.mock("../../../utils/validation", () => ({
  validateShippingAddress: jest.fn(() => ({ isValid: true, errors: {} })),
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
  return {
    CheckoutError,
    ValidationError,
    PaymentError: class extends CheckoutError {
      constructor(msg: string, details?: any) {
        super(msg, "PAYMENT_ERROR", details);
      }
    },
    handleElasticPathError: jest.fn(
      (err: any) => new CheckoutError(err?.message || "EP error")
    ),
    handleStripeError: jest.fn(
      (err: any) => new CheckoutError(err?.message || "Stripe error")
    ),
    logError: jest.fn(),
    getHttpStatusForError: jest.fn((err: any) => {
      if (err.code === "VALIDATION_ERROR") return 400;
      if (err.code === "ELASTIC_PATH_ERROR") return 502;
      return 500;
    }),
  };
});

// Use require after mocks to avoid esbuild import hoisting
const calculateShippingHandler =
  require("../calculate-shipping").default;
const { getShippingOptions } = require("@epcc-sdk/sdks-shopper");
const {
  createSuccessResponse,
  createErrorResponse,
  validateMethod,
  validateRequestBody,
} = require("../../../utils/api-helpers");
const {
  validateShippingAddress,
  validateEnvironmentVariables,
} = require("../../../utils/validation");
const {
  handleElasticPathError,
  logError,
  getHttpStatusForError,
  CheckoutError,
  ValidationError,
} = require("../../../utils/error-handling");

// ── Helpers ────────────────────────────────────────────────────────────

function createMockReq(method: string, body: any) {
  return { method, body };
}

function createMockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const validAddress = {
  first_name: "Jane",
  last_name: "Doe",
  line_1: "123 Main St",
  city: "Springfield",
  country: "US",
  postcode: "62701",
};

function makeEpOption(overrides: Record<string, any> = {}) {
  return {
    id: "ship-001",
    name: "Standard Shipping",
    description: "Arrives in 5-7 business days",
    price: { amount: 599, currency: "USD" },
    delivery_time: "5-7 business days",
    service_level: "standard",
    carrier: "USPS",
    ...overrides,
  };
}

function makeShippingResponse(options: any[]) {
  return { data: { data: options } };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("calculateShippingHandler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      EP_CLIENT_ID: "test-client-id",
      EP_HOST: "https://api.moltin.com",
    };
    // Reset mock implementations to defaults
    (validateShippingAddress as jest.Mock).mockReturnValue({
      isValid: true,
      errors: {},
    });
    (validateEnvironmentVariables as jest.Mock).mockImplementation(() => {});
    (getShippingOptions as jest.Mock).mockResolvedValue(
      makeShippingResponse([makeEpOption()])
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── Environment validation ──────────────────────────────────────────

  describe("environment validation", () => {
    it("should call validateEnvironmentVariables before any other logic", async () => {
      const error = new ValidationError("Missing environment variables");
      (validateEnvironmentVariables as jest.Mock).mockImplementation(() => {
        throw error;
      });

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(validateEnvironmentVariables).toHaveBeenCalledTimes(1);
      // validateMethod should NOT have been called because env check throws first
      expect(validateMethod).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── HTTP method validation ──────────────────────────────────────────

  describe("HTTP method validation", () => {
    it("should return 405 for GET requests", async () => {
      const req = createMockReq("GET", null);
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ message: "Method not allowed" }),
        })
      );
    });

    it("should return 405 for PUT requests", async () => {
      const req = createMockReq("PUT", null);
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
    });

    it("should return 405 for DELETE requests", async () => {
      const req = createMockReq("DELETE", null);
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
    });
  });

  // ── Request body validation ─────────────────────────────────────────

  describe("request body validation", () => {
    it("should return error when request body is missing", async () => {
      const req = createMockReq("POST", undefined);
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      // validateRequestBody throws -> caught by catch block
      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it("should return error when cartId is missing from body", async () => {
      const req = createMockReq("POST", { shippingAddress: validAddress });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it("should return error when shippingAddress is missing from body", async () => {
      const req = createMockReq("POST", { cartId: "cart-1" });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it("should return validation error for empty cartId string", async () => {
      const req = createMockReq("POST", {
        cartId: "",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Valid cart ID is required",
          }),
        })
      );
    });

    it("should return validation error when cartId is a number instead of string", async () => {
      const req = createMockReq("POST", {
        cartId: 12345,
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Valid cart ID is required",
          }),
        })
      );
    });
  });

  // ── Shipping address validation ─────────────────────────────────────

  describe("shipping address validation", () => {
    it("should return validation error for invalid shipping address", async () => {
      (validateShippingAddress as jest.Mock).mockReturnValue({
        isValid: false,
        errors: { city: "City is required", postcode: "Postcode is required" },
      });

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: { first_name: "Jane" },
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(validateShippingAddress).toHaveBeenCalledWith({
        first_name: "Jane",
      });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Invalid shipping address",
            code: "VALIDATION_ERROR",
            details: {
              fieldErrors: {
                city: "City is required",
                postcode: "Postcode is required",
              },
            },
          }),
        })
      );
    });

    it("should call validateShippingAddress with the provided address", async () => {
      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(validateShippingAddress).toHaveBeenCalledWith(validAddress);
    });
  });

  // ── Successful shipping calculation ─────────────────────────────────

  describe("successful shipping calculation", () => {
    it("should return 200 with shipping rates on success", async () => {
      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createSuccessResponse).toHaveBeenCalledWith({
        shippingRates: expect.any(Array),
      });
    });

    it("should call getShippingOptions with correct client config and cart ID", async () => {
      const req = createMockReq("POST", {
        cartId: "cart-42",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(getShippingOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          client: {
            settings: {
              application_id: "test-client-id",
              host: "https://api.moltin.com",
            },
          },
          path: { cartID: "cart-42" },
          body: {
            data: {
              shipping_address: expect.objectContaining({
                first_name: validAddress.first_name,
                last_name: validAddress.last_name,
                line_1: validAddress.line_1,
                city: validAddress.city,
                country: validAddress.country,
                postcode: validAddress.postcode,
              }),
            },
          },
        })
      );
    });

    it("should map shipping rate fields correctly from EP response", async () => {
      const epOption = makeEpOption();
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([epOption])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(createSuccessResponse).toHaveBeenCalledWith({
        shippingRates: [
          {
            id: "ship-001",
            name: "Standard Shipping",
            description: "Arrives in 5-7 business days",
            amount: 599,
            currency: "USD",
            delivery_time: "5-7 business days",
            service_level: "standard",
            carrier: "USPS",
          },
        ],
      });
    });

    it("should handle multiple shipping options from EP", async () => {
      const options = [
        makeEpOption({ id: "ship-001", name: "Standard", price: { amount: 500, currency: "USD" } }),
        makeEpOption({ id: "ship-002", name: "Express", price: { amount: 1299, currency: "USD" } }),
        makeEpOption({ id: "ship-003", name: "Next Day", price: { amount: 2499, currency: "USD" } }),
      ];
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse(options)
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const successArg = (createSuccessResponse as jest.Mock).mock.calls[0][0];
      expect(successArg.shippingRates).toHaveLength(3);
      expect(successArg.shippingRates[0].id).toBe("ship-001");
      expect(successArg.shippingRates[1].id).toBe("ship-002");
      expect(successArg.shippingRates[2].id).toBe("ship-003");
    });

    it("should handle empty shipping rates array from EP", async () => {
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createSuccessResponse).toHaveBeenCalledWith({
        shippingRates: [],
      });
    });
  });

  // ── Default/missing optional fields ─────────────────────────────────

  describe("missing optional fields in EP response", () => {
    it("should default name to description when name is missing", async () => {
      const option = makeEpOption({ name: undefined, description: "Economy option" });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].name).toBe("Economy option");
    });

    it("should default name to 'Shipping' when both name and description are missing", async () => {
      const option = makeEpOption({ name: undefined, description: undefined });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].name).toBe("Shipping");
    });

    it("should default description to empty string when missing", async () => {
      const option = makeEpOption({ description: undefined });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].description).toBe("");
    });

    it("should default amount to 0 when price is missing", async () => {
      const option = makeEpOption({ price: undefined });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].amount).toBe(0);
    });

    it("should default currency to 'USD' when price.currency is missing", async () => {
      const option = makeEpOption({ price: { amount: 500 } });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].currency).toBe("USD");
    });

    it("should default delivery_time to null when missing", async () => {
      const option = makeEpOption({ delivery_time: undefined });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].delivery_time).toBeNull();
    });

    it("should default service_level to 'standard' when missing", async () => {
      const option = makeEpOption({ service_level: undefined });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].service_level).toBe("standard");
    });

    it("should default carrier to null when missing", async () => {
      const option = makeEpOption({ carrier: undefined });
      (getShippingOptions as jest.Mock).mockResolvedValue(
        makeShippingResponse([option])
      );

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const rates = (createSuccessResponse as jest.Mock).mock.calls[0][0].shippingRates;
      expect(rates[0].carrier).toBeNull();
    });
  });

  // ── EP API error handling ───────────────────────────────────────────

  describe("EP API error handling", () => {
    it("should return error when getShippingOptions response has no data", async () => {
      (getShippingOptions as jest.Mock).mockResolvedValue({ data: null });

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "No shipping options available",
          }),
        })
      );
    });

    it("should return error when getShippingOptions response.data.data is null", async () => {
      (getShippingOptions as jest.Mock).mockResolvedValue({
        data: { data: null },
      });

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(createErrorResponse).toHaveBeenCalledWith(
        "No shipping options available",
        "CHECKOUT_ERROR",
        undefined
      );
    });

    it("should handle EP API rejection with handleElasticPathError", async () => {
      const apiError = new Error("Network timeout");
      (getShippingOptions as jest.Mock).mockRejectedValue(apiError);

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(handleElasticPathError).toHaveBeenCalledWith(apiError);
      expect(logError).toHaveBeenCalledWith(
        expect.any(CheckoutError),
        expect.objectContaining({
          endpoint: "calculate-shipping",
          cartId: "cart-1",
        })
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("should not call handleElasticPathError for CheckoutError instances", async () => {
      const checkoutErr = new CheckoutError("Custom checkout failure");
      (getShippingOptions as jest.Mock).mockRejectedValue(checkoutErr);

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(handleElasticPathError).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Custom checkout failure",
          }),
        })
      );
    });

    it("should use getHttpStatusForError to determine response status code", async () => {
      (getHttpStatusForError as jest.Mock).mockReturnValue(502);
      const apiError = new Error("Upstream failure");
      (getShippingOptions as jest.Mock).mockRejectedValue(apiError);

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(getHttpStatusForError).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(502);
    });

    it("should log error context with endpoint name, cartId, and timestamp", async () => {
      const apiError = new Error("Something broke");
      (getShippingOptions as jest.Mock).mockRejectedValue(apiError);

      const req = createMockReq("POST", {
        cartId: "cart-xyz",
        shippingAddress: validAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      expect(logError).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          endpoint: "calculate-shipping",
          cartId: "cart-xyz",
          timestamp: expect.any(String),
        })
      );
    });
  });

  // ── Shipping address passthrough ────────────────────────────────────

  describe("shipping address passthrough to EP", () => {
    it("should default optional line_2 and county to empty strings", async () => {
      const addressNoOptionals = {
        first_name: "Bob",
        last_name: "Smith",
        line_1: "456 Oak Ave",
        city: "Portland",
        country: "US",
        postcode: "97201",
      };

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: addressNoOptionals,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const callArgs = (getShippingOptions as jest.Mock).mock.calls[0][0];
      const shippingAddr = callArgs.body.data.shipping_address;
      expect(shippingAddr.line_2).toBe("");
      expect(shippingAddr.county).toBe("");
    });

    it("should pass through line_2 and county when provided", async () => {
      const fullAddress = {
        ...validAddress,
        line_2: "Apt 4B",
        county: "Sangamon",
      };

      const req = createMockReq("POST", {
        cartId: "cart-1",
        shippingAddress: fullAddress,
      });
      const res = createMockRes();

      await calculateShippingHandler(req, res);

      const callArgs = (getShippingOptions as jest.Mock).mock.calls[0][0];
      const shippingAddr = callArgs.body.data.shipping_address;
      expect(shippingAddr.line_2).toBe("Apt 4B");
      expect(shippingAddr.county).toBe("Sangamon");
    });
  });
});
