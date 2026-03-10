/**
 * Design-time mock data for EPCheckoutSessionProvider previewStates.
 *
 * These mocks let designers see realistic data in the Plasmic canvas without
 * a running server or real cart.
 */
import type { CheckoutSession } from "./types";

const BASE_SESSION: CheckoutSession = {
  id: "mock-session-id",
  status: "open",
  cartId: "mock-cart-id",
  cartHash: "mock-hash",
  customerInfo: {
    name: "Jane Doe",
    email: "jane@example.com",
  },
  shippingAddress: {
    firstName: "Jane",
    lastName: "Doe",
    line1: "123 Main St",
    line2: "Apt 4B",
    city: "New York",
    county: "NY",
    country: "US",
    postcode: "10001",
  },
  billingAddress: {
    firstName: "Jane",
    lastName: "Doe",
    line1: "123 Main St",
    line2: "Apt 4B",
    city: "New York",
    county: "NY",
    country: "US",
    postcode: "10001",
  },
  selectedShippingRateId: "rate-standard",
  availableShippingRates: [
    {
      id: "rate-standard",
      name: "Standard Shipping",
      description: "5-7 business days",
      amount: 599,
      currency: "USD",
      deliveryTime: "5-7 business days",
      serviceLevel: "standard",
      carrier: "USPS",
    },
    {
      id: "rate-express",
      name: "Express Shipping",
      description: "2-3 business days",
      amount: 1299,
      currency: "USD",
      deliveryTime: "2-3 business days",
      serviceLevel: "express",
      carrier: "UPS",
    },
  ],
  totals: {
    subtotal: 4999,
    tax: 437,
    shipping: 599,
    total: 6035,
    currency: "USD",
  },
  payment: {
    gateway: null,
    status: "idle",
    clientToken: null,
    gatewayMetadata: {},
    actionData: null,
  },
  order: null,
  expiresAt: Date.now() + 30 * 60 * 1000,
};

function makeSession(
  overrides: Partial<CheckoutSession>
): CheckoutSession {
  return { ...BASE_SESSION, ...overrides };
}

export const MOCK_SESSION_COLLECTING = makeSession({
  status: "open",
  payment: { ...BASE_SESSION.payment, status: "idle" },
});

export const MOCK_SESSION_PAYING = makeSession({
  status: "processing",
  payment: {
    gateway: "stripe",
    status: "pending",
    clientToken: "pi_mock_secret",
    gatewayMetadata: { paymentIntentId: "pi_mock" },
    actionData: null,
  },
  order: { id: "mock-order-id", transactionId: "mock-txn-id" },
});

export const MOCK_SESSION_COMPLETE = makeSession({
  status: "complete",
  payment: {
    gateway: "stripe",
    status: "succeeded",
    clientToken: null,
    gatewayMetadata: { paymentIntentId: "pi_mock" },
    actionData: null,
  },
  order: { id: "mock-order-id", transactionId: "mock-txn-id" },
});

export type PreviewState = "auto" | "collecting" | "paying" | "complete";

export function getMockSession(
  previewState: PreviewState
): CheckoutSession {
  switch (previewState) {
    case "collecting":
      return MOCK_SESSION_COLLECTING;
    case "paying":
      return MOCK_SESSION_PAYING;
    case "complete":
      return MOCK_SESSION_COMPLETE;
    case "auto":
    default:
      return MOCK_SESSION_COLLECTING;
  }
}
