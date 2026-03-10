/**
 * A-10.11: Address translation utility tests
 *
 * Covers toEPAddress (camelCase → snake_case), fromEPAddress (snake_case →
 * camelCase), round-trip identity, and optional-field handling.
 */
import { toEPAddress, fromEPAddress, toEPCustomer } from "../address-utils";
import type { SessionAddress, SessionCustomerInfo } from "../types";
import type { EPAddress } from "../address-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ADDRESS_MINIMAL: SessionAddress = {
  firstName: "Jane",
  lastName: "Doe",
  line1: "123 Main St",
  city: "Springfield",
  country: "US",
  postcode: "12345",
};

const SESSION_ADDRESS_FULL: SessionAddress = {
  firstName: "Jane",
  lastName: "Doe",
  line1: "123 Main St",
  line2: "Apt 4B",
  city: "Springfield",
  county: "Sangamon",
  country: "US",
  postcode: "12345",
};

const EP_ADDRESS_MINIMAL: EPAddress = {
  first_name: "Jane",
  last_name: "Doe",
  line_1: "123 Main St",
  city: "Springfield",
  country: "US",
  postcode: "12345",
};

const EP_ADDRESS_FULL: EPAddress = {
  first_name: "Jane",
  last_name: "Doe",
  line_1: "123 Main St",
  line_2: "Apt 4B",
  city: "Springfield",
  county: "Sangamon",
  country: "US",
  postcode: "12345",
};

// ---------------------------------------------------------------------------
// toEPAddress
// ---------------------------------------------------------------------------

describe("toEPAddress", () => {
  it("converts required camelCase fields to snake_case", () => {
    const result = toEPAddress(SESSION_ADDRESS_MINIMAL);
    expect(result.first_name).toBe("Jane");
    expect(result.last_name).toBe("Doe");
    expect(result.line_1).toBe("123 Main St");
    expect(result.city).toBe("Springfield");
    expect(result.country).toBe("US");
    expect(result.postcode).toBe("12345");
  });

  it("does not include line_2 when line2 is absent", () => {
    const result = toEPAddress(SESSION_ADDRESS_MINIMAL);
    expect(result.line_2).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "line_2")).toBe(false);
  });

  it("does not include county when county is absent", () => {
    const result = toEPAddress(SESSION_ADDRESS_MINIMAL);
    expect(result.county).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "county")).toBe(false);
  });

  it("includes line_2 when line2 is provided", () => {
    const result = toEPAddress(SESSION_ADDRESS_FULL);
    expect(result.line_2).toBe("Apt 4B");
  });

  it("includes county when county is provided", () => {
    const result = toEPAddress(SESSION_ADDRESS_FULL);
    expect(result.county).toBe("Sangamon");
  });

  it("matches the expected EP shape for a full address", () => {
    expect(toEPAddress(SESSION_ADDRESS_FULL)).toEqual(EP_ADDRESS_FULL);
  });
});

// ---------------------------------------------------------------------------
// fromEPAddress
// ---------------------------------------------------------------------------

describe("fromEPAddress", () => {
  it("converts required snake_case fields to camelCase", () => {
    const result = fromEPAddress(EP_ADDRESS_MINIMAL);
    expect(result.firstName).toBe("Jane");
    expect(result.lastName).toBe("Doe");
    expect(result.line1).toBe("123 Main St");
    expect(result.city).toBe("Springfield");
    expect(result.country).toBe("US");
    expect(result.postcode).toBe("12345");
  });

  it("does not include line2 when line_2 is absent", () => {
    const result = fromEPAddress(EP_ADDRESS_MINIMAL);
    expect(result.line2).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "line2")).toBe(false);
  });

  it("does not include county when county is absent", () => {
    const result = fromEPAddress(EP_ADDRESS_MINIMAL);
    expect(result.county).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "county")).toBe(false);
  });

  it("includes line2 when line_2 is provided", () => {
    const result = fromEPAddress(EP_ADDRESS_FULL);
    expect(result.line2).toBe("Apt 4B");
  });

  it("includes county when county is provided", () => {
    const result = fromEPAddress(EP_ADDRESS_FULL);
    expect(result.county).toBe("Sangamon");
  });

  it("matches the expected session shape for a full address", () => {
    expect(fromEPAddress(EP_ADDRESS_FULL)).toEqual(SESSION_ADDRESS_FULL);
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("address round-trip", () => {
  it("toEPAddress(fromEPAddress(addr)) produces the original EP address (minimal)", () => {
    expect(toEPAddress(fromEPAddress(EP_ADDRESS_MINIMAL))).toEqual(
      EP_ADDRESS_MINIMAL
    );
  });

  it("toEPAddress(fromEPAddress(addr)) produces the original EP address (full)", () => {
    expect(toEPAddress(fromEPAddress(EP_ADDRESS_FULL))).toEqual(EP_ADDRESS_FULL);
  });

  it("fromEPAddress(toEPAddress(addr)) produces the original session address (minimal)", () => {
    expect(fromEPAddress(toEPAddress(SESSION_ADDRESS_MINIMAL))).toEqual(
      SESSION_ADDRESS_MINIMAL
    );
  });

  it("fromEPAddress(toEPAddress(addr)) produces the original session address (full)", () => {
    expect(fromEPAddress(toEPAddress(SESSION_ADDRESS_FULL))).toEqual(
      SESSION_ADDRESS_FULL
    );
  });
});

// ---------------------------------------------------------------------------
// toEPCustomer
// ---------------------------------------------------------------------------

describe("toEPCustomer", () => {
  it("returns name and email from SessionCustomerInfo", () => {
    const info: SessionCustomerInfo = {
      name: "Jane Doe",
      email: "jane@example.com",
    };
    expect(toEPCustomer(info)).toEqual({
      name: "Jane Doe",
      email: "jane@example.com",
    });
  });
});
