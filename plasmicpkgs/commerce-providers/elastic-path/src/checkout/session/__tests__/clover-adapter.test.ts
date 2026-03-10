/**
 * B-4.1: Clover adapter tests
 *
 * Covers: charge success (no 3DS), 3DS method flow, 3DS challenge flow,
 * challenge escalation, card declined, retry on network error, missing
 * token/order/totals, and idempotency key derivation.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */

jest.mock("../adapters/clover-api", () => ({
  chargeClover: jest.fn(),
  finalizeCloverPayment: jest.fn(),
  deriveIdempotencyKey: jest.fn((orderId: string) => `clover-charge-${orderId}`),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cloverApi = require("../adapters/clover-api") as {
  chargeClover: jest.Mock;
  finalizeCloverPayment: jest.Mock;
  deriveIdempotencyKey: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCloverAdapter } = require("../adapters/clover-adapter") as {
  createCloverAdapter: typeof import("../adapters/clover-adapter").createCloverAdapter;
};

import type { CheckoutSession } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADAPTER_CONFIG = {
  apiKey: "test-api-key",
  apiBase: "https://scl-sandbox.dev.clover.com",
};

function makeSession(overrides?: Partial<CheckoutSession>): CheckoutSession {
  return {
    id: "sess_123",
    status: "open",
    cartId: "cart_abc",
    cartHash: "hash_abc",
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
    totals: { subtotal: 5000, tax: 500, shipping: 800, total: 6300, currency: "usd" },
    payment: {
      gateway: "clover",
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: { id: "order_xyz", transactionId: "txn_123" },
    expiresAt: Date.now() + 1800_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createCloverAdapter", () => {
  const adapter = createCloverAdapter(ADAPTER_CONFIG);

  beforeEach(() => jest.clearAllMocks());

  describe("initializePayment", () => {
    it("returns ready when charge succeeds with no 3DS", async () => {
      cloverApi.chargeClover.mockResolvedValue({
        id: "charge_001",
        amount: 6300,
        currency: "usd",
        status: "succeeded",
      });

      const result = await adapter.initializePayment(makeSession(), {
        token: "tok_visa",
      });

      expect(result.status).toBe("ready");
      expect(result.gatewayMetadata).toEqual({ chargeId: "charge_001" });
      expect(result.gatewayOrderId).toBe("charge_001");
      expect(cloverApi.chargeClover).toHaveBeenCalledWith(
        "tok_visa",
        6300,
        "usd",
        "order_xyz",
        "clover-charge-order_xyz",
        "test-api-key",
        "https://scl-sandbox.dev.clover.com"
      );
    });

    it("returns requires_action with 3ds_method when 3DS METHOD_FLOW", async () => {
      cloverApi.chargeClover.mockResolvedValue({
        id: "charge_002",
        amount: 6300,
        currency: "usd",
        status: "pending",
        threeDsData: {
          status: "METHOD_FLOW",
          methodData: {
            _3DSServerTransId: "trans_id_1",
            acsMethodUrl: "https://acs.example.com/method",
            methodNotificationUrl: "https://notify.example.com",
          },
        },
      });

      const result = await adapter.initializePayment(makeSession(), {
        token: "tok_visa",
      });

      expect(result.status).toBe("requires_action");
      expect(result.actionData).toEqual({
        type: "3ds_method",
        chargeId: "charge_002",
        _3DSServerTransId: "trans_id_1",
        acsMethodUrl: "https://acs.example.com/method",
        methodNotificationUrl: "https://notify.example.com",
      });
    });

    it("returns requires_action with 3ds_challenge when 3DS CHALLENGE", async () => {
      cloverApi.chargeClover.mockResolvedValue({
        id: "charge_003",
        amount: 6300,
        currency: "usd",
        status: "pending",
        threeDsData: {
          status: "CHALLENGE",
          challengeData: {
            messageVersion: "2.2.0",
            acsTransID: "acs_trans_1",
            acsUrl: "https://acs.example.com/challenge",
            threeDSServerTransID: "3ds_trans_1",
          },
        },
      });

      const result = await adapter.initializePayment(makeSession(), {
        token: "tok_visa",
      });

      expect(result.status).toBe("requires_action");
      expect(result.actionData).toEqual({
        type: "3ds_challenge",
        chargeId: "charge_003",
        messageVersion: "2.2.0",
        acsTransID: "acs_trans_1",
        acsUrl: "https://acs.example.com/challenge",
        threeDSServerTransID: "3ds_trans_1",
      });
    });

    it("returns failed with 'Your card was declined' on 402", async () => {
      const err = Object.assign(new Error("Card declined by issuer"), {
        code: "card_declined",
      });
      cloverApi.chargeClover.mockRejectedValue(err);

      const result = await adapter.initializePayment(makeSession(), {
        token: "tok_declined",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Your card was declined");
    });

    it("retries once on network error then succeeds", async () => {
      const networkError = new TypeError("fetch failed");
      cloverApi.chargeClover
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          id: "charge_retry",
          amount: 6300,
          currency: "usd",
          status: "succeeded",
        });

      const result = await adapter.initializePayment(makeSession(), {
        token: "tok_visa",
      });

      expect(result.status).toBe("ready");
      expect(cloverApi.chargeClover).toHaveBeenCalledTimes(2);
    });

    it("returns failed when token is missing", async () => {
      const result = await adapter.initializePayment(makeSession(), {});
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Missing Clover token");
    });

    it("returns failed when order ID is missing", async () => {
      const session = makeSession({ order: null });
      const result = await adapter.initializePayment(session, {
        token: "tok_visa",
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("No order ID in session");
    });

    it("returns failed when totals are missing", async () => {
      const session = makeSession({ totals: null });
      const result = await adapter.initializePayment(session, {
        token: "tok_visa",
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Missing totals in session");
    });

    it("uses correct idempotency key from order ID", async () => {
      cloverApi.chargeClover.mockResolvedValue({
        id: "charge_idem",
        amount: 6300,
        currency: "usd",
        status: "succeeded",
      });

      await adapter.initializePayment(makeSession(), { token: "tok_visa" });

      expect(cloverApi.deriveIdempotencyKey).toHaveBeenCalledWith("order_xyz");
      expect(cloverApi.chargeClover).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "clover-charge-order_xyz",
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe("confirmPayment", () => {
    it("returns succeeded on successful finalization", async () => {
      cloverApi.finalizeCloverPayment.mockResolvedValue({
        id: "charge_001",
        amount: 6300,
        currency: "usd",
        status: "succeeded",
      });

      const result = await adapter.confirmPayment(makeSession(), {
        chargeId: "charge_001",
        flowStatus: "Y",
      });

      expect(result.status).toBe("succeeded");
      expect(result.gatewayOrderId).toBe("charge_001");
      expect(cloverApi.finalizeCloverPayment).toHaveBeenCalledWith(
        "charge_001",
        "Y",
        "test-api-key",
        "https://scl-sandbox.dev.clover.com"
      );
    });

    it("returns requires_action on challenge escalation", async () => {
      cloverApi.finalizeCloverPayment.mockResolvedValue({
        id: "charge_esc",
        amount: 6300,
        currency: "usd",
        status: "pending",
        threeDsData: {
          status: "CHALLENGE",
          challengeData: {
            messageVersion: "2.2.0",
            acsTransID: "acs_esc",
            acsUrl: "https://acs.example.com/challenge",
            threeDSServerTransID: "3ds_esc",
          },
        },
      });

      const result = await adapter.confirmPayment(makeSession(), {
        chargeId: "charge_001",
        flowStatus: "Y",
      });

      expect(result.status).toBe("requires_action");
      expect(result.actionData).toEqual({
        type: "3ds_challenge",
        chargeId: "charge_esc",
        messageVersion: "2.2.0",
        acsTransID: "acs_esc",
        acsUrl: "https://acs.example.com/challenge",
        threeDSServerTransID: "3ds_esc",
      });
    });

    it("returns failed on AUTHENTICATION_FAILED", async () => {
      cloverApi.finalizeCloverPayment.mockResolvedValue({
        id: "charge_fail",
        amount: 6300,
        currency: "usd",
        status: "failed",
        threeDsData: {
          status: "AUTHENTICATION_FAILED",
        },
      });

      const result = await adapter.confirmPayment(makeSession(), {
        chargeId: "charge_001",
        flowStatus: "N",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("3D Secure authentication failed");
    });

    it("returns failed when chargeId is missing", async () => {
      const result = await adapter.confirmPayment(makeSession(), {
        flowStatus: "Y",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toContain("Missing chargeId or flowStatus");
    });

    it("returns failed when flowStatus is missing", async () => {
      const result = await adapter.confirmPayment(makeSession(), {
        chargeId: "charge_001",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toContain("Missing chargeId or flowStatus");
    });

    it("returns failed when finalize API throws", async () => {
      cloverApi.finalizeCloverPayment.mockRejectedValue(
        new Error("Clover finalize_payment failed (500): Internal error")
      );

      const result = await adapter.confirmPayment(makeSession(), {
        chargeId: "charge_001",
        flowStatus: "Y",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toContain("Clover finalize_payment failed");
    });
  });
});

describe("deriveIdempotencyKey", () => {
  it("produces clover-charge-{orderId} pattern", () => {
    const { deriveIdempotencyKey } = jest.requireActual("../adapters/clover-api");
    expect(deriveIdempotencyKey("order_123")).toBe("clover-charge-order_123");
    expect(deriveIdempotencyKey("abc")).toBe("clover-charge-abc");
  });
});
