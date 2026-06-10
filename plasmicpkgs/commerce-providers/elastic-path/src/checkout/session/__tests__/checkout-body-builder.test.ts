/**
 * Checkout Body Builder — pure function that constructs the EP `checkoutApi`
 * request body from a CheckoutSession.
 *
 * Slice 1 (this PR): guest path only. Shape is `CustomerCheckout` with
 * customer (name, email), billing_address, shipping_address.
 *
 * EP requires snake_case + several fields (company_name, line_2, county) as
 * present strings even when empty. The builder fills these defaults so the
 * SessionAddress shape doesn't have to model them.
 *
 * Slices 2+ add: account checkout (subscription items present + accountToken),
 * order_number / external_ref, etc.
 */
import { buildGuestCheckoutBody } from "../checkout-body-builder";
import type { CheckoutSession } from "../types";

function makeSession(overrides?: Partial<CheckoutSession>): CheckoutSession {
  return {
    id: "sess_1",
    status: "open",
    cartId: "cart_1",
    cartHash: "h",
    customerInfo: { name: "Jane Doe", email: "jane@example.com" },
    shippingAddress: {
      firstName: "Jane",
      lastName: "Doe",
      line1: "123 Main St",
      city: "Springfield",
      country: "US",
      postcode: "62701",
    },
    billingAddress: {
      firstName: "Jane",
      lastName: "Doe",
      line1: "123 Main St",
      city: "Springfield",
      country: "US",
      postcode: "62701",
    },
    selectedShippingRateId: "rate_1",
    availableShippingRates: [],
    totals: null,
    payment: {
      gateway: null,
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: null,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("buildGuestCheckoutBody", () => {
  it("returns the EP CustomerCheckout shape for a guest session with minimum fields", () => {
    const body = buildGuestCheckoutBody(makeSession());

    expect(body).toEqual({
      data: {
        customer: { name: "Jane Doe", email: "jane@example.com" },
        billing_address: {
          first_name: "Jane",
          last_name: "Doe",
          line_1: "123 Main St",
          line_2: "",
          city: "Springfield",
          postcode: "62701",
          country: "US",
          county: "",
          company_name: "",
        },
        shipping_address: {
          first_name: "Jane",
          last_name: "Doe",
          line_1: "123 Main St",
          line_2: "",
          city: "Springfield",
          postcode: "62701",
          country: "US",
          county: "",
          company_name: "",
        },
      },
    });
  });

  it("preserves optional fields (line2, county) when present", () => {
    const body = buildGuestCheckoutBody(
      makeSession({
        billingAddress: {
          firstName: "Jane",
          lastName: "Doe",
          line1: "123 Main St",
          line2: "Apt 4",
          city: "Springfield",
          county: "Greene",
          country: "US",
          postcode: "62701",
        },
        shippingAddress: {
          firstName: "Jane",
          lastName: "Doe",
          line1: "123 Main St",
          line2: "Suite 7",
          city: "Springfield",
          county: "Greene",
          country: "US",
          postcode: "62701",
        },
      })
    );

    expect(body.data.billing_address.line_2).toBe("Apt 4");
    expect(body.data.billing_address.county).toBe("Greene");
    expect(body.data.shipping_address.line_2).toBe("Suite 7");
    expect(body.data.shipping_address.county).toBe("Greene");
  });

  it("throws when required session fields are missing", () => {
    expect(() => buildGuestCheckoutBody(makeSession({ customerInfo: null }))).toThrow(
      /customerInfo/
    );
    expect(() =>
      buildGuestCheckoutBody(makeSession({ shippingAddress: null }))
    ).toThrow(/shippingAddress/);
    expect(() =>
      buildGuestCheckoutBody(makeSession({ billingAddress: null }))
    ).toThrow(/billingAddress/);
  });

  it("carries the company name onto company_name", () => {
    const body = buildGuestCheckoutBody(
      makeSession({
        billingAddress: {
          firstName: "Jane",
          lastName: "Doe",
          company: "Acme Corp",
          line1: "123 Main St",
          city: "Springfield",
          country: "US",
          postcode: "62701",
        },
      })
    );
    expect(body.data.billing_address.company_name).toBe("Acme Corp");
  });

  it("defaults shipping to billing when requiresShipping is false and no shipping address is set", () => {
    const body = buildGuestCheckoutBody(
      makeSession({
        requiresShipping: false,
        shippingAddress: null,
        selectedShippingRateId: null,
        billingAddress: {
          firstName: "Jane",
          lastName: "Doe",
          line1: "5 Billing Rd",
          city: "Geneva",
          country: "CH",
          postcode: "1201",
        },
      })
    );
    expect(body.data.shipping_address.line_1).toBe("5 Billing Rd");
    expect(body.data.shipping_address.city).toBe("Geneva");
  });

  it("still throws on missing shipping when requiresShipping is not false", () => {
    expect(() =>
      buildGuestCheckoutBody(
        makeSession({ requiresShipping: true, shippingAddress: null })
      )
    ).toThrow(/shippingAddress/);
  });
});
