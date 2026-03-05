jest.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

import {
  CheckoutError,
  ValidationError,
  PaymentError,
  OrderError,
  ElasticPathError,
  StripeError,
  handleElasticPathError,
  handleStripeError,
  createValidationError,
  logError,
  errorToApiResponse,
  getUserErrorMessage,
  isRetryableError,
  getHttpStatusForError,
} from "../error-handling";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("CheckoutError", () => {
  it("sets default code and name", () => {
    const err = new CheckoutError("something broke");
    expect(err.message).toBe("something broke");
    expect(err.code).toBe("CHECKOUT_ERROR");
    expect(err.name).toBe("CheckoutError");
    expect(err.details).toBeUndefined();
  });

  it("accepts custom code and details", () => {
    const details = { field: "email" };
    const err = new CheckoutError("bad input", "CUSTOM_CODE", details);
    expect(err.code).toBe("CUSTOM_CODE");
    expect(err.details).toEqual(details);
  });

  it("extends Error", () => {
    const err = new CheckoutError("msg");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CheckoutError);
  });

  it("has a stack trace", () => {
    const err = new CheckoutError("msg");
    expect(err.stack).toBeDefined();
  });
});

describe("ValidationError", () => {
  it("sets correct code and name", () => {
    const err = new ValidationError("invalid");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.name).toBe("ValidationError");
  });

  it("extends CheckoutError and Error", () => {
    const err = new ValidationError("invalid");
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err).toBeInstanceOf(Error);
  });

  it("passes details through", () => {
    const details = { fieldErrors: { email: "required" } };
    const err = new ValidationError("invalid", details);
    expect(err.details).toEqual(details);
  });
});

describe("PaymentError", () => {
  it("sets correct code and name", () => {
    const err = new PaymentError("declined");
    expect(err.code).toBe("PAYMENT_ERROR");
    expect(err.name).toBe("PaymentError");
  });

  it("extends CheckoutError and Error", () => {
    const err = new PaymentError("declined");
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("OrderError", () => {
  it("sets correct code and name", () => {
    const err = new OrderError("order failed");
    expect(err.code).toBe("ORDER_ERROR");
    expect(err.name).toBe("OrderError");
  });

  it("extends CheckoutError and Error", () => {
    const err = new OrderError("order failed");
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ElasticPathError", () => {
  it("sets correct code and name", () => {
    const err = new ElasticPathError("ep failed");
    expect(err.code).toBe("ELASTIC_PATH_ERROR");
    expect(err.name).toBe("ElasticPathError");
  });

  it("extends CheckoutError and Error", () => {
    const err = new ElasticPathError("ep failed");
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("StripeError", () => {
  it("sets correct code and name", () => {
    const err = new StripeError("stripe failed");
    expect(err.code).toBe("STRIPE_ERROR");
    expect(err.name).toBe("StripeError");
  });

  it("extends CheckoutError and Error", () => {
    const err = new StripeError("stripe failed");
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// handleElasticPathError
// ---------------------------------------------------------------------------

describe("handleElasticPathError", () => {
  it("joins detail messages from response.data.errors", () => {
    const error = {
      message: "Request failed",
      response: {
        data: {
          errors: [
            { detail: "Name is required" },
            { detail: "Email is invalid" },
          ],
        },
      },
    };
    const result = handleElasticPathError(error);
    expect(result).toBeInstanceOf(ElasticPathError);
    expect(result.message).toBe("Name is required, Email is invalid");
    expect(result.details).toEqual({
      originalError: error,
      epErrors: error.response.data.errors,
    });
  });

  it("falls back to title when detail is missing", () => {
    const error = {
      response: {
        data: {
          errors: [{ title: "Bad Request" }],
        },
      },
    };
    const result = handleElasticPathError(error);
    expect(result.message).toBe("Bad Request");
  });

  it("returns auth error for 401 status", () => {
    const error = { response: { status: 401 } };
    const result = handleElasticPathError(error);
    expect(result).toBeInstanceOf(ElasticPathError);
    expect(result.message).toBe(
      "Authentication failed. Please check your API credentials."
    );
  });

  it("returns not found error for 404 status", () => {
    const error = { response: { status: 404 } };
    const result = handleElasticPathError(error);
    expect(result).toBeInstanceOf(ElasticPathError);
    expect(result.message).toBe("Resource not found.");
  });

  it("returns service unavailable for 500+ status", () => {
    const error = { response: { status: 500 } };
    const result = handleElasticPathError(error);
    expect(result.message).toBe(
      "Elastic Path service is temporarily unavailable."
    );
  });

  it("returns service unavailable for 503 status", () => {
    const error = { response: { status: 503 } };
    const result = handleElasticPathError(error);
    expect(result.message).toBe(
      "Elastic Path service is temporarily unavailable."
    );
  });

  it("uses error.message as fallback", () => {
    const error = { message: "Network timeout" };
    const result = handleElasticPathError(error);
    expect(result).toBeInstanceOf(ElasticPathError);
    expect(result.message).toBe("Network timeout");
    expect(result.details).toEqual({ originalError: error });
  });

  it("falls back to generic message when no message", () => {
    const error = {};
    const result = handleElasticPathError(error);
    expect(result.message).toBe(
      "An unknown error occurred with Elastic Path."
    );
  });

  it("prioritizes response.data.errors over status code", () => {
    const error = {
      response: {
        status: 401,
        data: {
          errors: [{ detail: "Token expired" }],
        },
      },
    };
    const result = handleElasticPathError(error);
    expect(result.message).toBe("Token expired");
  });
});

// ---------------------------------------------------------------------------
// handleStripeError
// ---------------------------------------------------------------------------

describe("handleStripeError", () => {
  it("returns PaymentError for card_error", () => {
    const error = {
      type: "card_error",
      code: "card_declined",
      message: "Your card was declined.",
    };
    const result = handleStripeError(error);
    expect(result).toBeInstanceOf(PaymentError);
    expect(result.message).toBe("Your card was declined.");
    expect(result.details).toEqual({
      stripeError: error,
      code: "card_declined",
    });
  });

  it("uses default message for card_error without message", () => {
    const error = { type: "card_error", code: "generic_decline" };
    const result = handleStripeError(error);
    expect(result).toBeInstanceOf(PaymentError);
    expect(result.message).toBe("Your card was declined.");
  });

  it("returns ValidationError for validation_error", () => {
    const error = {
      type: "validation_error",
      code: "invalid_expiry",
      message: "Expiry date is invalid.",
    };
    const result = handleStripeError(error);
    expect(result).toBeInstanceOf(ValidationError);
    expect(result.message).toBe("Expiry date is invalid.");
  });

  it("uses default message for validation_error without message", () => {
    const error = { type: "validation_error" };
    const result = handleStripeError(error);
    expect(result.message).toBe("Invalid payment information.");
  });

  it("returns StripeError for api_error", () => {
    const error = { type: "api_error", code: "api_err" };
    const result = handleStripeError(error);
    expect(result).toBeInstanceOf(StripeError);
    expect(result.message).toBe(
      "Payment processing is temporarily unavailable."
    );
  });

  it("returns StripeError for authentication_error", () => {
    const error = { type: "authentication_error", code: "auth_err" };
    const result = handleStripeError(error);
    expect(result).toBeInstanceOf(StripeError);
    expect(result.message).toBe("Payment authentication failed.");
  });

  it("returns PaymentError for unknown type", () => {
    const error = {
      type: "idempotency_error",
      code: "idem",
      message: "Idempotency key used",
    };
    const result = handleStripeError(error);
    expect(result).toBeInstanceOf(PaymentError);
    expect(result.message).toBe("Idempotency key used");
    expect(result.details).toEqual({
      stripeError: error,
      type: "idempotency_error",
      code: "idem",
    });
  });

  it("uses default message for unknown type without message", () => {
    const error = { type: "unknown_type" };
    const result = handleStripeError(error);
    expect(result.message).toBe("Payment processing failed.");
  });

  it("handles error with no type", () => {
    const error = { message: "Something failed" };
    const result = handleStripeError(error);
    expect(result).toBeInstanceOf(PaymentError);
    expect(result.message).toBe("Something failed");
  });
});

// ---------------------------------------------------------------------------
// createValidationError
// ---------------------------------------------------------------------------

describe("createValidationError", () => {
  it("creates a ValidationError with field errors in details", () => {
    const fieldErrors = {
      email: "Email is required",
      name: "Name is too short",
    };
    const result = createValidationError(fieldErrors);
    expect(result).toBeInstanceOf(ValidationError);
    expect(result.message).toBe("Validation failed");
    expect(result.details).toEqual({ fieldErrors });
  });

  it("uses custom general message", () => {
    const result = createValidationError(
      { zip: "Invalid zip" },
      "Address validation failed"
    );
    expect(result.message).toBe("Address validation failed");
    expect(result.details).toEqual({ fieldErrors: { zip: "Invalid zip" } });
  });

  it("works with empty field errors", () => {
    const result = createValidationError({});
    expect(result).toBeInstanceOf(ValidationError);
    expect(result.details).toEqual({ fieldErrors: {} });
  });
});

// ---------------------------------------------------------------------------
// logError
// ---------------------------------------------------------------------------

describe("logError", () => {
  it("does not throw when called with a CheckoutError", () => {
    const err = new CheckoutError("test");
    expect(() => logError(err)).not.toThrow();
  });

  it("accepts optional context", () => {
    const err = new PaymentError("pay fail", { id: "123" });
    expect(() => logError(err, { orderId: "abc" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// errorToApiResponse
// ---------------------------------------------------------------------------

describe("errorToApiResponse", () => {
  it("returns the correct structure", () => {
    const err = new ValidationError("bad input", { fieldErrors: { a: "b" } });
    const response = errorToApiResponse(err);
    expect(response).toEqual({
      success: false,
      error: {
        message: "bad input",
        code: "VALIDATION_ERROR",
        details: { fieldErrors: { a: "b" } },
      },
    });
  });

  it("success is always false", () => {
    const err = new CheckoutError("msg");
    expect(errorToApiResponse(err).success).toBe(false);
  });

  it("includes undefined details when none provided", () => {
    const err = new CheckoutError("msg");
    const response = errorToApiResponse(err);
    expect(response.error.details).toBeUndefined();
  });

  it("works with subclass errors", () => {
    const err = new StripeError("stripe msg", { key: "val" });
    const response = errorToApiResponse(err);
    expect(response.error.code).toBe("STRIPE_ERROR");
    expect(response.error.message).toBe("stripe msg");
    expect(response.error.details).toEqual({ key: "val" });
  });
});

// ---------------------------------------------------------------------------
// getUserErrorMessage
// ---------------------------------------------------------------------------

describe("getUserErrorMessage", () => {
  it("returns message from CheckoutError", () => {
    const err = new PaymentError("Card declined");
    expect(getUserErrorMessage(err)).toBe("Card declined");
  });

  it("returns message from ValidationError (also a CheckoutError)", () => {
    const err = new ValidationError("Invalid email");
    expect(getUserErrorMessage(err)).toBe("Invalid email");
  });

  it("returns message from plain Error", () => {
    const err = new Error("plain error");
    expect(getUserErrorMessage(err)).toBe("plain error");
  });

  it("returns message from object with message property", () => {
    expect(getUserErrorMessage({ message: "custom msg" })).toBe("custom msg");
  });

  it("returns generic message when no message property", () => {
    expect(getUserErrorMessage({})).toBe(
      "An unexpected error occurred. Please try again."
    );
  });

  it("returns generic message for null-ish input", () => {
    // The function accesses error.message; for primitives this may vary,
    // but an object without message should hit the fallback.
    expect(getUserErrorMessage({ foo: "bar" })).toBe(
      "An unexpected error occurred. Please try again."
    );
  });
});

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe("isRetryableError", () => {
  it.each([
    "NETWORK_ERROR",
    "TIMEOUT_ERROR",
    "RATE_LIMIT_ERROR",
    "TEMPORARY_UNAVAILABLE",
  ])("returns true for %s", (code) => {
    const err = new CheckoutError("msg", code);
    expect(isRetryableError(err)).toBe(true);
  });

  it.each([
    "CHECKOUT_ERROR",
    "VALIDATION_ERROR",
    "PAYMENT_ERROR",
    "ORDER_ERROR",
    "ELASTIC_PATH_ERROR",
    "STRIPE_ERROR",
    "AUTHENTICATION_ERROR",
  ])("returns false for %s", (code) => {
    const err = new CheckoutError("msg", code);
    expect(isRetryableError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getHttpStatusForError
// ---------------------------------------------------------------------------

describe("getHttpStatusForError", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["AUTHENTICATION_ERROR", 401],
    ["AUTHORIZATION_ERROR", 403],
    ["NOT_FOUND_ERROR", 404],
    ["RATE_LIMIT_ERROR", 429],
    ["ELASTIC_PATH_ERROR", 502],
    ["STRIPE_ERROR", 502],
    ["TIMEOUT_ERROR", 504],
  ])("maps %s to %d", (code, expectedStatus) => {
    const err = new CheckoutError("msg", code as string);
    expect(getHttpStatusForError(err)).toBe(expectedStatus);
  });

  it("returns 500 for unknown error code", () => {
    const err = new CheckoutError("msg", "UNKNOWN_CODE");
    expect(getHttpStatusForError(err)).toBe(500);
  });

  it("returns 500 for default CHECKOUT_ERROR code", () => {
    const err = new CheckoutError("msg");
    expect(getHttpStatusForError(err)).toBe(500);
  });

  it("maps concrete subclass by code, not by class", () => {
    // A ValidationError has code VALIDATION_ERROR -> 400
    const err = new ValidationError("invalid");
    expect(getHttpStatusForError(err)).toBe(400);

    // An ElasticPathError has code ELASTIC_PATH_ERROR -> 502
    const epErr = new ElasticPathError("ep");
    expect(getHttpStatusForError(epErr)).toBe(502);

    // A StripeError has code STRIPE_ERROR -> 502
    const stripeErr = new StripeError("stripe");
    expect(getHttpStatusForError(stripeErr)).toBe(502);

    // A PaymentError has code PAYMENT_ERROR -> 500 (default)
    const payErr = new PaymentError("pay");
    expect(getHttpStatusForError(payErr)).toBe(500);
  });
});
