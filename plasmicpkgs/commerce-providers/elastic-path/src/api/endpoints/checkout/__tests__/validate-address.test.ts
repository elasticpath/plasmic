// Mock external dependencies before any imports
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
  validateBillingAddress: jest.fn(() => ({ isValid: true, errors: {} })),
  validateShippingAddress: jest.fn(() => ({ isValid: true, errors: {} })),
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
    logError: jest.fn(),
    getHttpStatusForError: jest.fn((err: any) => {
      if (err.code === "VALIDATION_ERROR") return 400;
      return 500;
    }),
  };
});

// Use require after mocks to avoid esbuild import hoisting
const validateAddressHandler = require("../validate-address").default;
const {
  validateBillingAddress,
  validateShippingAddress,
} = require("../../../utils/validation");
const {
  createSuccessResponse,
  createErrorResponse,
  validateMethod,
} = require("../../../utils/api-helpers");
const {
  logError,
  getHttpStatusForError,
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

function validAddress() {
  return {
    first_name: "Jane",
    last_name: "Doe",
    line_1: "123 Main St",
    city: "Portland",
    county: "OR",
    country: "US",
    postcode: "97201",
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("validateAddressHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock implementations to defaults
    (validateShippingAddress as jest.Mock).mockReturnValue({
      isValid: true,
      errors: {},
    });
    (validateBillingAddress as jest.Mock).mockReturnValue({
      isValid: true,
      errors: {},
    });
  });

  // ── Successful shipping address validation (default type) ──────────

  describe("successful shipping address validation", () => {
    it("should return 200 with isValid: true for a valid shipping address (default type)", async () => {
      const req = createMockReq("POST", { address: validAddress() });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(validateShippingAddress).toHaveBeenCalledWith(validAddress());
      expect(validateBillingAddress).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isValid: true,
          errors: undefined,
        })
      );
    });

    it("should use shipping validation when type is explicitly 'shipping'", async () => {
      const req = createMockReq("POST", {
        address: validAddress(),
        type: "shipping",
      });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(validateShippingAddress).toHaveBeenCalledWith(validAddress());
      expect(validateBillingAddress).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should include normalized address when normalization succeeds", async () => {
      const req = createMockReq("POST", { address: validAddress() });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isValid: true,
          normalized: expect.objectContaining({
            first_name: "Jane",
            last_name: "Doe",
            country: "US",
          }),
        })
      );
    });
  });

  // ── Successful billing address validation ──────────────────────────

  describe("successful billing address validation", () => {
    it("should use billing validation when type is 'billing'", async () => {
      const req = createMockReq("POST", {
        address: validAddress(),
        type: "billing",
      });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(validateBillingAddress).toHaveBeenCalledWith(validAddress());
      expect(validateShippingAddress).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isValid: true,
        })
      );
    });
  });

  // ── Method not allowed ─────────────────────────────────────────────

  describe("HTTP method validation", () => {
    it("should return 405 for GET requests", async () => {
      const req = createMockReq("GET", null);
      const res = createMockRes();

      await validateAddressHandler(req, res);

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

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
    });

    it("should return 405 for DELETE requests", async () => {
      const req = createMockReq("DELETE", null);
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
    });
  });

  // ── Missing address field ─────────────────────────────────────────

  describe("missing address field", () => {
    it("should return error when request body is missing entirely", async () => {
      const req = createMockReq("POST", undefined);
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it("should return error when address field is missing from body", async () => {
      const req = createMockReq("POST", { type: "shipping" });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      // validateRequestBody throws for missing 'address' field
      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });
  });

  // ── Invalid address object ────────────────────────────────────────

  describe("invalid address object", () => {
    it("should throw ValidationError when address is null", async () => {
      const req = createMockReq("POST", { address: null });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Valid address object is required",
            code: "VALIDATION_ERROR",
          }),
        })
      );
    });

    it("should throw ValidationError when address is a string", async () => {
      const req = createMockReq("POST", { address: "123 Main St" });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Valid address object is required",
            code: "VALIDATION_ERROR",
          }),
        })
      );
    });

    it("should throw ValidationError when address is a number", async () => {
      const req = createMockReq("POST", { address: 12345 });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Valid address object is required",
            code: "VALIDATION_ERROR",
          }),
        })
      );
    });
  });

  // ── Validation fails ──────────────────────────────────────────────

  describe("validation fails", () => {
    it("should return isValid: false with field errors for invalid shipping address", async () => {
      const fieldErrors = {
        city: "City is required",
        postcode: "Postcode is required",
      };
      (validateShippingAddress as jest.Mock).mockReturnValue({
        isValid: false,
        errors: fieldErrors,
      });

      const req = createMockReq("POST", {
        address: { first_name: "Jane" },
      });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isValid: false,
          errors: fieldErrors,
        })
      );
    });

    it("should return isValid: false with field errors for invalid billing address", async () => {
      const fieldErrors = {
        line_1: "Street address is required",
        country: "Country is required",
      };
      (validateBillingAddress as jest.Mock).mockReturnValue({
        isValid: false,
        errors: fieldErrors,
      });

      const req = createMockReq("POST", {
        address: { first_name: "Jane" },
        type: "billing",
      });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isValid: false,
          errors: fieldErrors,
        })
      );
    });

    it("should not attempt normalization when validation fails", async () => {
      (validateShippingAddress as jest.Mock).mockReturnValue({
        isValid: false,
        errors: { city: "City is required" },
      });

      const req = createMockReq("POST", {
        address: { first_name: "Jane" },
      });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      // normalized should be undefined when validation fails
      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isValid: false,
          normalized: undefined,
        })
      );
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe("error handling", () => {
    it("should catch unexpected errors and return appropriate status code", async () => {
      (validateShippingAddress as jest.Mock).mockImplementation(() => {
        throw new Error("Unexpected failure");
      });

      const req = createMockReq("POST", { address: validAddress() });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      // Non-ValidationError is wrapped in a ValidationError by the catch block
      expect(logError).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          endpoint: "validate-address",
          timestamp: expect.any(String),
        })
      );
      expect(getHttpStatusForError).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it("should use getHttpStatusForError to determine response status code", async () => {
      (getHttpStatusForError as jest.Mock).mockReturnValue(400);
      (validateShippingAddress as jest.Mock).mockImplementation(() => {
        throw new ValidationError("Bad address data");
      });

      const req = createMockReq("POST", { address: validAddress() });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(getHttpStatusForError).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should preserve ValidationError message in the error response", async () => {
      (validateShippingAddress as jest.Mock).mockImplementation(() => {
        throw new ValidationError("Custom validation message");
      });

      const req = createMockReq("POST", { address: validAddress() });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(createErrorResponse).toHaveBeenCalledWith(
        "Custom validation message",
        "VALIDATION_ERROR",
        undefined
      );
    });

    it("should wrap non-ValidationError into a ValidationError in the catch block", async () => {
      (validateShippingAddress as jest.Mock).mockImplementation(() => {
        throw new Error("Something broke");
      });

      const req = createMockReq("POST", { address: validAddress() });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      // The catch block wraps generic errors as ValidationError with default message
      expect(createErrorResponse).toHaveBeenCalledWith(
        "Address validation failed",
        "VALIDATION_ERROR",
        undefined
      );
    });

    it("should log error context with endpoint name and address type", async () => {
      (validateBillingAddress as jest.Mock).mockImplementation(() => {
        throw new Error("Billing check failed");
      });

      const req = createMockReq("POST", {
        address: validAddress(),
        type: "billing",
      });
      const res = createMockRes();

      await validateAddressHandler(req, res);

      expect(logError).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          endpoint: "validate-address",
          addressType: "billing",
          timestamp: expect.any(String),
        })
      );
    });
  });
});
