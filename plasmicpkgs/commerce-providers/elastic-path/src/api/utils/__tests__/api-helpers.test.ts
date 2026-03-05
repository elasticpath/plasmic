jest.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

import {
  createApiResponse,
  createSuccessResponse,
  createErrorResponse,
  validateEnvironment,
  validateMethod,
  validateRequestBody,
  safeJsonParse,
  toCents,
  fromCents,
  generateOrderReference,
  isValidEmail,
  isValidPhone,
  sanitizeString,
  RateLimiter,
} from "../api-helpers";

describe("api-helpers", () => {
  // ─── createApiResponse ────────────────────────────────────────────

  describe("createApiResponse", () => {
    it("creates a success response with data", () => {
      const result = createApiResponse(true, { id: 1 });
      expect(result).toEqual({
        success: true,
        data: { id: 1 },
        error: undefined,
      });
    });

    it("creates a failure response with error", () => {
      const error = { message: "bad request", code: "BAD_REQUEST" };
      const result = createApiResponse(false, undefined, error);
      expect(result).toEqual({
        success: false,
        data: undefined,
        error,
      });
    });

    it("creates a response with no data and no error", () => {
      const result = createApiResponse(true);
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("includes error details when provided", () => {
      const error = {
        message: "validation failed",
        code: "VALIDATION",
        details: { field: "email" },
      };
      const result = createApiResponse(false, undefined, error);
      expect(result.error?.details).toEqual({ field: "email" });
    });
  });

  // ─── createSuccessResponse ────────────────────────────────────────

  describe("createSuccessResponse", () => {
    it("wraps data in a success response", () => {
      const data = { items: [1, 2, 3] };
      const result = createSuccessResponse(data);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.error).toBeUndefined();
    });

    it("works with primitive data", () => {
      const result = createSuccessResponse("ok");
      expect(result.success).toBe(true);
      expect(result.data).toBe("ok");
    });

    it("works with null data", () => {
      const result = createSuccessResponse(null);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  // ─── createErrorResponse ──────────────────────────────────────────

  describe("createErrorResponse", () => {
    it("creates an error response with message only", () => {
      const result = createErrorResponse("something went wrong");
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error?.message).toBe("something went wrong");
      expect(result.error?.code).toBeUndefined();
      expect(result.error?.details).toBeUndefined();
    });

    it("creates an error response with message and code", () => {
      const result = createErrorResponse("not found", "NOT_FOUND");
      expect(result.error?.message).toBe("not found");
      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("creates an error response with message, code, and details", () => {
      const details = { missingFields: ["name", "email"] };
      const result = createErrorResponse("validation", "VALIDATION", details);
      expect(result.error?.details).toEqual(details);
    });
  });

  // ─── validateEnvironment ──────────────────────────────────────────

  describe("validateEnvironment", () => {
    const originalEnv = process.env;

    beforeAll(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    beforeEach(() => {
      // Clear the relevant env vars before each test
      delete process.env.EP_CLIENT_ID;
      delete process.env.EP_HOST;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    });

    it("does not throw when all required vars are set", () => {
      process.env.EP_CLIENT_ID = "test-id";
      process.env.EP_HOST = "https://api.example.com";
      process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
      process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_xxx";

      expect(() => validateEnvironment()).not.toThrow();
    });

    it("throws when all required vars are missing", () => {
      expect(() => validateEnvironment()).toThrow(
        /Missing required environment variables/
      );
      expect(() => validateEnvironment()).toThrow(/EP_CLIENT_ID/);
      expect(() => validateEnvironment()).toThrow(/EP_HOST/);
      expect(() => validateEnvironment()).toThrow(/STRIPE_SECRET_KEY/);
      expect(() => validateEnvironment()).toThrow(/STRIPE_PUBLISHABLE_KEY/);
    });

    it("throws listing only the missing vars", () => {
      process.env.EP_CLIENT_ID = "test-id";
      process.env.EP_HOST = "https://api.example.com";
      // STRIPE keys are missing

      expect(() => validateEnvironment()).toThrow(/STRIPE_SECRET_KEY/);
      expect(() => validateEnvironment()).toThrow(/STRIPE_PUBLISHABLE_KEY/);
      // Present vars should not appear in the error
      try {
        validateEnvironment();
      } catch (e: any) {
        expect(e.message).not.toContain("EP_CLIENT_ID");
        expect(e.message).not.toContain("EP_HOST");
      }
    });

    it("treats empty string as missing", () => {
      process.env.EP_CLIENT_ID = "";
      process.env.EP_HOST = "https://api.example.com";
      process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
      process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_xxx";

      expect(() => validateEnvironment()).toThrow(/EP_CLIENT_ID/);
    });
  });

  // ─── validateMethod ───────────────────────────────────────────────

  describe("validateMethod", () => {
    it("returns true when method is in the allowed list", () => {
      const req = { method: "POST" };
      expect(validateMethod(req, ["GET", "POST"])).toBe(true);
    });

    it("returns false when method is not allowed", () => {
      const req = { method: "DELETE" };
      expect(validateMethod(req, ["GET", "POST"])).toBe(false);
    });

    it("is case-sensitive", () => {
      const req = { method: "post" };
      expect(validateMethod(req, ["POST"])).toBe(false);
    });

    it("returns false for undefined method", () => {
      const req = {};
      expect(validateMethod(req, ["GET"])).toBe(false);
    });
  });

  // ─── validateRequestBody ──────────────────────────────────────────

  describe("validateRequestBody", () => {
    it("returns the body when all required fields are present", () => {
      const req = { body: { name: "Alice", email: "a@b.com" } };
      const result = validateRequestBody<{ name: string; email: string }>(
        req,
        ["name", "email"]
      );
      expect(result).toEqual({ name: "Alice", email: "a@b.com" });
    });

    it("throws when body is missing", () => {
      const req = {};
      expect(() => validateRequestBody(req, ["name"])).toThrow(
        "Request body is required"
      );
    });

    it("throws when body is null", () => {
      const req = { body: null };
      expect(() => validateRequestBody(req, ["name"])).toThrow(
        "Request body is required"
      );
    });

    it("throws when body is a non-object", () => {
      const req = { body: "string" };
      expect(() => validateRequestBody(req, ["name"])).toThrow(
        "Request body is required"
      );
    });

    it("throws listing missing fields", () => {
      const req = { body: { name: "Alice" } };
      expect(() =>
        validateRequestBody<{ name: string; email: string; age: number }>(req, [
          "name",
          "email",
          "age",
        ])
      ).toThrow(/email/);
    });

    it("passes with no required fields", () => {
      const req = { body: { anything: true } };
      expect(() => validateRequestBody(req, [])).not.toThrow();
    });

    it("accepts fields with falsy values (0, false, empty string)", () => {
      const req = { body: { count: 0, active: false, label: "" } };
      const result = validateRequestBody<{
        count: number;
        active: boolean;
        label: string;
      }>(req, ["count", "active", "label"]);
      expect(result.count).toBe(0);
      expect(result.active).toBe(false);
      expect(result.label).toBe("");
    });
  });

  // ─── safeJsonParse ────────────────────────────────────────────────

  describe("safeJsonParse", () => {
    it("parses valid JSON", () => {
      const result = safeJsonParse<{ a: number }>('{"a":1}');
      expect(result).toEqual({ a: 1 });
    });

    it("parses a JSON array", () => {
      const result = safeJsonParse<number[]>("[1,2,3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("returns null for invalid JSON", () => {
      expect(safeJsonParse("not json")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(safeJsonParse("")).toBeNull();
    });

    it("parses JSON primitives", () => {
      expect(safeJsonParse<number>("42")).toBe(42);
      expect(safeJsonParse<string>('"hello"')).toBe("hello");
      expect(safeJsonParse<boolean>("true")).toBe(true);
      expect(safeJsonParse<null>("null")).toBeNull();
    });
  });

  // ─── toCents ──────────────────────────────────────────────────────

  describe("toCents", () => {
    it("converts whole dollars to cents", () => {
      expect(toCents(10)).toBe(1000);
    });

    it("converts dollars and cents", () => {
      expect(toCents(19.99)).toBe(1999);
    });

    it("rounds fractional cents", () => {
      // 10.005 * 100 = 1000.4999... due to floating point — should round to 1001
      expect(toCents(10.005)).toBe(1001);
    });

    it("handles zero", () => {
      expect(toCents(0)).toBe(0);
    });

    it("handles negative amounts", () => {
      expect(toCents(-5.5)).toBe(-550);
    });

    it("handles common floating point issues (e.g. 0.1 + 0.2)", () => {
      // 0.1 + 0.2 = 0.30000000000000004 in JS
      expect(toCents(0.1 + 0.2)).toBe(30);
    });
  });

  // ─── fromCents ────────────────────────────────────────────────────

  describe("fromCents", () => {
    it("converts cents to dollars", () => {
      expect(fromCents(1000)).toBe(10);
    });

    it("converts cents with remainder", () => {
      expect(fromCents(1999)).toBe(19.99);
    });

    it("handles zero", () => {
      expect(fromCents(0)).toBe(0);
    });

    it("handles negative cents", () => {
      expect(fromCents(-550)).toBe(-5.5);
    });

    it("handles single cent", () => {
      expect(fromCents(1)).toBe(0.01);
    });
  });

  // ─── generateOrderReference ───────────────────────────────────────

  describe("generateOrderReference", () => {
    it("starts with EP-", () => {
      const ref = generateOrderReference();
      expect(ref.startsWith("EP-")).toBe(true);
    });

    it("is fully uppercase", () => {
      const ref = generateOrderReference();
      expect(ref).toBe(ref.toUpperCase());
    });

    it("matches the expected format EP-{timestamp}-{random}", () => {
      const ref = generateOrderReference();
      // EP- followed by base36 timestamp, dash, base36 random (6 chars)
      expect(ref).toMatch(/^EP-[A-Z0-9]+-[A-Z0-9]+$/);
    });

    it("generates unique references", () => {
      const refs = new Set(
        Array.from({ length: 50 }, () => generateOrderReference())
      );
      // With timestamp + random component, collisions should be extremely unlikely
      expect(refs.size).toBeGreaterThanOrEqual(45);
    });
  });

  // ─── isValidEmail ─────────────────────────────────────────────────

  describe("isValidEmail", () => {
    it.each([
      "user@example.com",
      "first.last@domain.org",
      "user+tag@sub.domain.co.uk",
      "name@123.123.123.com",
    ])("accepts valid email: %s", (email) => {
      expect(isValidEmail(email)).toBe(true);
    });

    it.each([
      "",
      "plaintext",
      "@no-local.com",
      "no-domain@",
      "no@domain",
      "spaces in@email.com",
      "user@.com",
    ])("rejects invalid email: %s", (email) => {
      expect(isValidEmail(email)).toBe(false);
    });
  });

  // ─── isValidPhone ─────────────────────────────────────────────────

  describe("isValidPhone", () => {
    it.each([
      "+1 555 123 4567",
      "555-123-4567",
      "(555) 123-4567",
      "+44 20 7946 0958",
      "1234567890",
    ])("accepts valid phone: %s", (phone) => {
      expect(isValidPhone(phone)).toBe(true);
    });

    it.each(["", "123", "abc", "12345"])("rejects invalid phone: %s", (phone) => {
      expect(isValidPhone(phone)).toBe(false);
    });
  });

  // ─── sanitizeString ───────────────────────────────────────────────

  describe("sanitizeString", () => {
    it("removes angle brackets", () => {
      expect(sanitizeString("<script>alert('xss')</script>")).toBe(
        "scriptalert('xss')/script"
      );
    });

    it("removes javascript: protocol (case-insensitive)", () => {
      expect(sanitizeString("javascript:alert(1)")).toBe("alert(1)");
      expect(sanitizeString("JAVASCRIPT:alert(1)")).toBe("alert(1)");
      expect(sanitizeString("JavaScript:void(0)")).toBe("void(0)");
    });

    it("trims whitespace", () => {
      expect(sanitizeString("  hello world  ")).toBe("hello world");
    });

    it("handles combined threats", () => {
      const input = "  <img src=x onerror=javascript:alert(1)>  ";
      const result = sanitizeString(input);
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
      expect(result).not.toMatch(/javascript:/i);
    });

    it("leaves clean strings unchanged", () => {
      expect(sanitizeString("Hello, World!")).toBe("Hello, World!");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(sanitizeString("   ")).toBe("");
    });
  });

  // ─── RateLimiter ──────────────────────────────────────────────────

  describe("RateLimiter", () => {
    let limiter: RateLimiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it("allows requests within the limit", () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.isAllowed("user1")).toBe(true);
      }
    });

    it("blocks requests exceeding the default limit (5)", () => {
      for (let i = 0; i < 5; i++) {
        limiter.isAllowed("user1");
      }
      expect(limiter.isAllowed("user1")).toBe(false);
    });

    it("respects a custom maxAttempts", () => {
      expect(limiter.isAllowed("user1", 2)).toBe(true);
      expect(limiter.isAllowed("user1", 2)).toBe(true);
      expect(limiter.isAllowed("user1", 2)).toBe(false);
    });

    it("tracks different keys independently", () => {
      for (let i = 0; i < 5; i++) {
        limiter.isAllowed("user1");
      }
      // user1 is exhausted but user2 should still be allowed
      expect(limiter.isAllowed("user1")).toBe(false);
      expect(limiter.isAllowed("user2")).toBe(true);
    });

    it("resets after the time window passes", () => {
      jest.useFakeTimers();
      try {
        const windowMs = 1000;
        // Exhaust attempts
        for (let i = 0; i < 3; i++) {
          limiter.isAllowed("user1", 3, windowMs);
        }
        expect(limiter.isAllowed("user1", 3, windowMs)).toBe(false);

        // Advance past the window
        jest.advanceTimersByTime(windowMs + 1);

        expect(limiter.isAllowed("user1", 3, windowMs)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it("slides the window — old attempts expire while new ones count", () => {
      jest.useFakeTimers();
      try {
        const windowMs = 1000;
        // Make 2 attempts at t=0
        limiter.isAllowed("key", 3, windowMs);
        limiter.isAllowed("key", 3, windowMs);

        // Advance 600ms and make 1 more (total 3 in window)
        jest.advanceTimersByTime(600);
        expect(limiter.isAllowed("key", 3, windowMs)).toBe(true);
        // Now at limit
        expect(limiter.isAllowed("key", 3, windowMs)).toBe(false);

        // Advance another 500ms (t=1100) — the first 2 attempts from t=0 expire
        jest.advanceTimersByTime(500);
        expect(limiter.isAllowed("key", 3, windowMs)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
