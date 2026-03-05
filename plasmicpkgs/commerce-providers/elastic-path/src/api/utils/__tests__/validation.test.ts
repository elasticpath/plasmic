jest.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

import {
  validateCustomerData,
  validateAddressData,
  validateBillingAddress,
  validateShippingAddress,
  validateCheckoutForm,
  validateOrderAmount,
  sanitizeCustomerData,
  sanitizeAddressData,
  validateEnvironmentVariables,
  validateRateLimit,
} from "../validation";
import type { CustomerData, AddressData } from "../../../checkout/types";

// ── Helpers ──────────────────────────────────────────────────────────────

function validCustomer(): CustomerData {
  return { name: "Jane Doe", email: "jane@example.com" };
}

function validAddress(): AddressData {
  return {
    first_name: "Jane",
    last_name: "Doe",
    line_1: "123 Main Street",
    city: "Portland",
    county: "OR",
    country: "US",
    postcode: "97201",
  };
}

// ── validateCustomerData ─────────────────────────────────────────────────

describe("validateCustomerData", () => {
  it("returns valid for complete customer data", () => {
    const result = validateCustomerData(validCustomer());
    expect(result.isValid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it("requires email", () => {
    const result = validateCustomerData({ name: "Jane", email: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  it("rejects invalid email", () => {
    const result = validateCustomerData({ name: "Jane", email: "not-an-email" });
    expect(result.isValid).toBe(false);
    expect(result.errors.email).toMatch(/valid email/i);
  });

  it("requires name", () => {
    const result = validateCustomerData({ name: "", email: "a@b.com" });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it("rejects name shorter than 2 characters", () => {
    const result = validateCustomerData({ name: "J", email: "a@b.com" });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toMatch(/at least 2/);
  });
});

// ── validateAddressData ──────────────────────────────────────────────────

describe("validateAddressData", () => {
  it("returns valid for complete address", () => {
    const result = validateAddressData(validAddress());
    expect(result.isValid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it("requires line_1", () => {
    const addr = { ...validAddress(), line_1: "" };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(false);
    expect(result.errors["billing.line_1"]).toBeDefined();
  });

  it("rejects line_1 shorter than 5 characters", () => {
    const addr = { ...validAddress(), line_1: "Hi" };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(false);
    expect(result.errors["billing.line_1"]).toMatch(/complete address/i);
  });

  it("requires city", () => {
    const addr = { ...validAddress(), city: "" };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(false);
    expect(result.errors["billing.city"]).toBeDefined();
  });

  it("requires postcode", () => {
    const addr = { ...validAddress(), postcode: "" };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(false);
    expect(result.errors["billing.postcode"]).toBeDefined();
  });

  it("rejects invalid US postal code", () => {
    const addr = { ...validAddress(), postcode: "XYZ" };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(false);
    expect(result.errors["billing.postcode"]).toMatch(/valid postal/i);
  });

  it("requires country", () => {
    const addr = { ...validAddress(), country: "" };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(false);
    expect(result.errors["billing.country"]).toBeDefined();
  });

  it("rejects invalid country code", () => {
    const addr = { ...validAddress(), country: "ZZ" };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(false);
    expect(result.errors["billing.country"]).toMatch(/valid country/i);
  });

  it("uses shipping prefix when isShipping=true", () => {
    const addr = { ...validAddress(), city: "" };
    const result = validateAddressData(addr, true);
    expect(result.errors["shipping.city"]).toBeDefined();
  });

  it("county is optional (no error when empty)", () => {
    const addr = { ...validAddress(), county: undefined };
    const result = validateAddressData(addr);
    expect(result.isValid).toBe(true);
  });
});

// ── validateBillingAddress / validateShippingAddress ──────────────────────

describe("validateBillingAddress", () => {
  it("delegates to validateAddressData with isShipping=false", () => {
    const addr = { ...validAddress(), city: "" };
    const result = validateBillingAddress(addr);
    expect(result.errors["billing.city"]).toBeDefined();
  });
});

describe("validateShippingAddress", () => {
  it("delegates to validateAddressData with isShipping=true", () => {
    const addr = { ...validAddress(), city: "" };
    const result = validateShippingAddress(addr);
    expect(result.errors["shipping.city"]).toBeDefined();
  });
});

// ── validateCheckoutForm ─────────────────────────────────────────────────

describe("validateCheckoutForm", () => {
  it("returns valid for complete form data", () => {
    const result = validateCheckoutForm({
      customer: validCustomer(),
      billingAddress: validAddress(),
      sameAsBilling: true,
    });
    expect(result.isValid).toBe(true);
  });

  it("combines customer and billing errors", () => {
    const result = validateCheckoutForm({
      customer: { name: "", email: "" },
      billingAddress: { ...validAddress(), line_1: "" },
      sameAsBilling: true,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.email).toBeDefined();
    expect(result.errors["billing.line_1"]).toBeDefined();
  });

  it("validates shipping address when sameAsBilling=false", () => {
    const result = validateCheckoutForm({
      customer: validCustomer(),
      billingAddress: validAddress(),
      shippingAddress: { ...validAddress(), city: "" },
      sameAsBilling: false,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors["shipping.city"]).toBeDefined();
  });

  it("skips shipping validation when sameAsBilling=true", () => {
    const result = validateCheckoutForm({
      customer: validCustomer(),
      billingAddress: validAddress(),
      shippingAddress: { ...validAddress(), city: "" },
      sameAsBilling: true,
    });
    expect(result.isValid).toBe(true);
  });
});

// ── validateOrderAmount ──────────────────────────────────────────────────

describe("validateOrderAmount", () => {
  it("returns valid for reasonable amount", () => {
    const result = validateOrderAmount(1000, "USD");
    expect(result.isValid).toBe(true);
  });

  it("rejects zero amount", () => {
    const result = validateOrderAmount(0, "USD");
    expect(result.isValid).toBe(false);
    expect(result.errors.amount).toBeDefined();
  });

  it("rejects negative amount", () => {
    const result = validateOrderAmount(-100, "USD");
    expect(result.isValid).toBe(false);
  });

  it("rejects amount exceeding limit", () => {
    const result = validateOrderAmount(100000000, "USD");
    expect(result.isValid).toBe(false);
  });

  it("rejects invalid currency code", () => {
    const result = validateOrderAmount(100, "US");
    expect(result.isValid).toBe(false);
    expect(result.errors.currency).toBeDefined();
  });
});

// ── sanitizeCustomerData ─────────────────────────────────────────────────

describe("sanitizeCustomerData", () => {
  it("preserves valid data", () => {
    const result = sanitizeCustomerData(validCustomer());
    expect(result.name).toBe("Jane Doe");
    expect(result.email).toBe("jane@example.com");
  });

  it("lowercases email", () => {
    const result = sanitizeCustomerData({ name: "Jane", email: "JANE@EXAMPLE.COM" });
    expect(result.email).toBe("jane@example.com");
  });

  it("strips angle brackets", () => {
    const result = sanitizeCustomerData({
      name: "<script>alert('xss')</script>",
      email: "a@b.com",
    });
    expect(result.name).not.toContain("<");
    expect(result.name).not.toContain(">");
  });

  it("trims whitespace", () => {
    const result = sanitizeCustomerData({ name: "  Jane  ", email: "  a@b.com  " });
    expect(result.name).toBe("Jane");
    expect(result.email).toBe("a@b.com");
  });
});

// ── sanitizeAddressData ──────────────────────────────────────────────────

describe("sanitizeAddressData", () => {
  it("preserves valid address fields", () => {
    const addr = validAddress();
    const result = sanitizeAddressData(addr);
    expect(result.first_name).toBe("Jane");
    expect(result.last_name).toBe("Doe");
    expect(result.line_1).toBe("123 Main Street");
    expect(result.city).toBe("Portland");
    expect(result.county).toBe("OR");
    expect(result.postcode).toBe("97201");
    expect(result.country).toBe("US");
  });

  it("uppercases country code", () => {
    const addr = { ...validAddress(), country: "us" };
    const result = sanitizeAddressData(addr);
    expect(result.country).toBe("US");
  });

  it("strips XSS from line_1", () => {
    const addr = { ...validAddress(), line_1: '<img onerror="alert(1)">' };
    const result = sanitizeAddressData(addr);
    expect(result.line_1).not.toContain("<");
    expect(result.line_1).not.toContain("onerror=");
  });

  it("handles undefined optional fields", () => {
    const addr = { ...validAddress(), line_2: undefined, county: undefined };
    const result = sanitizeAddressData(addr);
    expect(result.line_2).toBeUndefined();
    expect(result.county).toBeUndefined();
  });
});

// ── validateEnvironmentVariables ─────────────────────────────────────────

describe("validateEnvironmentVariables", () => {
  const original = process.env;

  beforeEach(() => {
    process.env = {
      ...original,
      EP_CLIENT_ID: "id",
      EP_HOST: "https://host",
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_PUBLISHABLE_KEY: "pk_test",
    };
  });

  afterAll(() => {
    process.env = original;
  });

  it("does not throw when all required vars are set", () => {
    expect(() => validateEnvironmentVariables()).not.toThrow();
  });

  it("throws when EP_CLIENT_ID is missing", () => {
    delete process.env.EP_CLIENT_ID;
    expect(() => validateEnvironmentVariables()).toThrow(/EP_CLIENT_ID/);
  });
});

// ── validateRateLimit ────────────────────────────────────────────────────

describe("validateRateLimit", () => {
  it("returns true (placeholder)", () => {
    expect(validateRateLimit("user-123")).toBe(true);
  });
});
