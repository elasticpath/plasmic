/**
 * handlePay — single-shot flow (slice 1: anonymous guest happy path).
 *
 * Flow:
 *   1. Load session + guard validation (status open, gateway/fields present).
 *   2. Cart-hash re-check.
 *   3. adapter.initializePayment(session, { confirmation_token })
 *   4. On succeeded: checkoutApi (cart→order) → confirmOrder → cart cleanup
 *      → applyPaymentSucceeded → 200 with status=complete.
 *   5. On failed: applyPaymentFailed → 200 with session.payment.status=failed,
 *      session.status=open (retryable). No EP order created.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() so interception
 * works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  confirmOrder: jest.fn(),
  paymentSetup: jest.fn(),
  updateACart: jest.fn(),
  updateAnOrder: jest.fn(),
  deleteACart: jest.fn(),
  manageCarts: jest.fn(),
  deleteACartItem: jest.fn(),
  createShopperClient: jest.fn(() => ({ client: {} })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  getACart: jest.Mock;
  checkoutApi: jest.Mock;
  confirmOrder: jest.Mock;
  paymentSetup: jest.Mock;
  updateACart: jest.Mock;
  updateAnOrder: jest.Mock;
  deleteACart: jest.Mock;
  manageCarts: jest.Mock;
  deleteACartItem: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handlePay } = require("../pay") as {
  handlePay: typeof import("../pay").handlePay;
};

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
  PaymentAdapter,
  PaymentAdapterResult,
  AdapterRegistry,
  SessionStore,
} from "../../../../checkout/session/types";
import { hashCart } from "../../../../checkout/session/cart-hash";

const CART_ITEMS = [
  { id: "item-1", quantity: 2, unit_price: { amount: 1500 } },
  { id: "item-2", quantity: 1, unit_price: { amount: 2400 } },
];

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-pay",
    status: "open",
    cartId: "cart-abc",
    cartHash: hashCart(CART_ITEMS),
    customerInfo: { name: "Jane Doe", email: "jane@example.com" },
    shippingAddress: {
      firstName: "Jane",
      lastName: "Doe",
      line1: "123 Main St",
      city: "Springfield",
      country: "US",
      postcode: "12345",
    },
    billingAddress: {
      firstName: "Jane",
      lastName: "Doe",
      line1: "123 Main St",
      city: "Springfield",
      country: "US",
      postcode: "12345",
    },
    selectedShippingRateId: "rate-standard",
    availableShippingRates: [
      { id: "rate-standard", name: "Standard", amount: 500, currency: "USD", serviceLevel: "standard" },
    ],
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

function createMockStore(session: CheckoutSession | null = null): SessionStore {
  return {
    get: jest.fn().mockResolvedValue(session),
    set: jest
      .fn()
      .mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=test; Path=/" } }),
    delete: jest
      .fn()
      .mockResolvedValue({ headers: { "Set-Cookie": "ep_cs=; Max-Age=0" } }),
  };
}

function createMockAdapter(
  initResult: PaymentAdapterResult = {
    status: "succeeded",
    gatewayOrderId: "pi_abc",
    gatewayMetadata: { paymentIntentId: "pi_abc" },
  }
): PaymentAdapter {
  return {
    initializePayment: jest.fn().mockResolvedValue(initResult),
    confirmPayment: jest.fn().mockResolvedValue({ status: "succeeded" }),
  };
}

function createMockRegistry(adapter?: PaymentAdapter): AdapterRegistry {
  return {
    register: jest.fn(),
    getAdapter: jest.fn().mockReturnValue(adapter),
  };
}

function createMockCtx(
  session: CheckoutSession | null,
  adapter?: PaymentAdapter,
  overrides: Partial<SessionHandlerContext> = {}
): SessionHandlerContext {
  return {
    epCredentials: {
      clientId: "test-id",
      apiBaseUrl: "https://api.test.com",
    },
    adapterRegistry: createMockRegistry(adapter),
    sessionStore: createMockStore(session),
    shopperAccessToken: "shopper-token",
    getClientCredentialsToken: jest.fn(async () => "admin-token"),
    ...overrides,
  };
}

function createMockReq(body: Record<string, unknown> = {}): SessionRequest {
  return { body, headers: {}, cookies: {} };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Normalizable cart (inner data + meta) so the shipping re-assertion's
  // cart re-read doesn't throw; non-zero meta total → paid path.
  epSdk.getACart.mockResolvedValue({
    data: {
      included: { items: CART_ITEMS },
      data: { id: "cart-abc", meta: { display_price: { with_tax: { amount: 5400, currency: "USD" } } } },
    },
  });
  epSdk.checkoutApi.mockResolvedValue({
    data: { data: { id: "order-1" } },
  });
  epSdk.confirmOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.paymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });
  epSdk.updateACart.mockResolvedValue({ data: { data: {} } });
  epSdk.updateAnOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.deleteACart.mockResolvedValue({ data: undefined });
  epSdk.manageCarts.mockResolvedValue({});
  epSdk.deleteACartItem.mockResolvedValue({});
});

const FREE_ITEMS = [
  { id: "free-1", quantity: 1, unit_price: { amount: 0 }, value: { amount: 0 } },
];

describe("handlePay — single-shot guest happy path", () => {
  it("succeeded payment → checkoutApi → confirmOrder → cart cleanup → status=complete", async () => {
    const adapter = createMockAdapter({
      status: "succeeded",
      gatewayOrderId: "pi_abc",
      gatewayMetadata: { paymentIntentId: "pi_abc" },
    });
    const ctx = createMockCtx(makeSession(), adapter);
    const req = createMockReq({
      gateway: "stripe",
      confirmation_token: "ctoken_xyz",
    });

    const res = await handlePay(req, ctx);

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.data.session.status).toBe("complete");
    expect(body.data.session.payment.status).toBe("succeeded");
    expect(body.data.session.order?.id).toBe("order-1");

    // adapter called with the confirmation_token from req body
    expect((adapter.initializePayment as jest.Mock).mock.calls[0][1]).toEqual({
      confirmation_token: "ctoken_xyz",
    });

    // EP order creation happened AFTER payment succeeded
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.confirmOrder).toHaveBeenCalledTimes(1);

    // Cart cleanup ran
    expect(epSdk.deleteACart).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-abc" } })
    );
  });

  it("failed payment leaves session open, payment.status=failed, no order created", async () => {
    const adapter = createMockAdapter({
      status: "failed",
      errorMessage: "card_declined",
    });
    const ctx = createMockCtx(makeSession(), adapter);
    const req = createMockReq({
      gateway: "stripe",
      confirmation_token: "ctoken_bad",
    });

    const res = await handlePay(req, ctx);

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.data.session.status).toBe("open");
    expect(body.data.session.payment.status).toBe("failed");
    expect(body.data.session.order).toBeNull();

    // No EP order created on payment failure
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
  });

  it("cart-hash mismatch returns 409 before payment is attempted", async () => {
    epSdk.getACart.mockResolvedValue({
      data: { included: { items: [{ id: "different", quantity: 99 }] } },
    });
    const adapter = createMockAdapter();
    const ctx = createMockCtx(makeSession(), adapter);

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctoken_xyz" }),
      ctx
    );

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CART_MISMATCH");
    expect(adapter.initializePayment).not.toHaveBeenCalled();
  });

  it("cart cleanup failure does not fail the response (housekeeping)", async () => {
    epSdk.deleteACart.mockRejectedValue(new Error("EP unavailable"));
    const adapter = createMockAdapter({
      status: "succeeded",
      gatewayOrderId: "pi_abc",
      gatewayMetadata: { paymentIntentId: "pi_abc" },
    });

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctoken_xyz" }),
      createMockCtx(makeSession(), adapter)
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
  });
});

describe("handlePay — zero-total (free) order", () => {
  beforeEach(() => {
    // A genuinely free cart reports an authoritative zero via
    // meta.display_price — the only signal that routes to free settlement.
    epSdk.getACart.mockResolvedValue({
      data: {
        included: { items: FREE_ITEMS },
        data: { meta: { display_price: { with_tax: { amount: 0, currency: "CHF" } } } },
      },
    });
  });

  it("settles a free order via the manual gateway with no card / adapter", async () => {
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({ cartHash: hashCart(FREE_ITEMS) }),
      adapter
    );
    // No gateway/confirmation_token — a free order needs no payment UI.
    const res = await handlePay(createMockReq({}), ctx);

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.data.session.status).toBe("complete");
    expect(body.data.session.payment.status).toBe("succeeded");
    expect(body.data.session.order?.id).toBe("order-1");

    // Manual settlement, not the Stripe adapter
    expect(adapter.initializePayment).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup.mock.calls[0][0].body.data).toEqual({
      gateway: "manual",
      method: "purchase",
    });
    // confirmOrder is the PaymentIntent-sync step — not used for manual.
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    expect(epSdk.deleteACart).toHaveBeenCalled();
  });

  it("writes customAttributes onto the order on the free path too", async () => {
    const ctx = createMockCtx(
      makeSession({
        cartHash: hashCart(FREE_ITEMS),
        customAttributes: { language: "English", marketing: false },
      }),
      undefined,
      { allowedCustomAttributeKeys: "*" }
    );
    await handlePay(createMockReq({}), ctx);

    expect(epSdk.updateAnOrder).toHaveBeenCalledTimes(1);
    expect(epSdk.updateAnOrder.mock.calls[0][0].body.data).toMatchObject({
      type: "order",
      language: "English",
      marketing: false,
    });
  });

  it("returns 502 when manual settlement fails (gateway not enabled)", async () => {
    epSdk.paymentSetup.mockRejectedValue(new Error("gateway disabled"));
    const ctx = createMockCtx(makeSession({ cartHash: hashCart(FREE_ITEMS) }));
    const res = await handlePay(createMockReq({}), ctx);

    expect(res.status).toBe(502);
    expect((res.body as any).error.code).toBe("EP_ERROR");
  });

  it("uses the cart META total (not parsed items) to decide free vs paid", async () => {
    // Regression: a paid cart whose item array doesn't parse must NOT settle
    // for free. getACart returns no parseable items but a non-zero meta total.
    epSdk.getACart.mockResolvedValue({
      data: {
        included: { items: [] },
        data: { meta: { display_price: { with_tax: { amount: 4400, currency: "CHF" } } } },
      },
    });
    const adapter = createMockAdapter({
      status: "succeeded",
      gatewayOrderId: "pi_paid",
      gatewayMetadata: { paymentIntentId: "pi_paid" },
    });
    const ctx = createMockCtx(makeSession({ cartHash: hashCart([]) }), adapter);
    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    // Paid path ran — the Stripe adapter was used, NOT manual settlement.
    expect(adapter.initializePayment).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
  });
});

describe("handlePay — generalised fields", () => {
  it("does not require shipping when requiresShipping is false", async () => {
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        requiresShipping: false,
        shippingAddress: null,
        selectedShippingRateId: null,
      }),
      adapter
    );
    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctoken_xyz" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect(adapter.initializePayment).toHaveBeenCalledTimes(1);
  });

  it("still requires shipping fields when requiresShipping is not false", async () => {
    const ctx = createMockCtx(
      makeSession({ shippingAddress: null, selectedShippingRateId: null })
    );
    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctoken_xyz" }),
      ctx
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("MISSING_FIELDS");
  });

  it("persists session customAttributes to the cart before checkout", async () => {
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        customAttributes: { industry: "Tech", marketingOptIn: true, vat: "" },
      }),
      adapter,
      { allowedCustomAttributeKeys: "*" }
    );
    await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctoken_xyz" }),
      ctx
    );

    expect(epSdk.updateACart).toHaveBeenCalledTimes(1);
    const attrs = epSdk.updateACart.mock.calls[0][0].body.data.custom_attributes;
    expect(attrs.industry).toEqual({ type: "string", value: "Tech" });
    expect(attrs.marketingOptIn).toEqual({ type: "boolean", value: true });
    // Empty values are dropped by toCustomAttributes.
    expect(attrs.vat).toBeUndefined();
  });

  it("writes session customAttributes onto the order as raw flow fields", async () => {
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        customAttributes: { industry: "Tech", marketingOptIn: true, vat: "" },
      }),
      adapter,
      { allowedCustomAttributeKeys: "*" }
    );
    await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctoken_xyz" }),
      ctx
    );

    // Order receives raw values under data (NOT the cart { type, value } shape).
    expect(epSdk.updateAnOrder).toHaveBeenCalledTimes(1);
    const orderBody = epSdk.updateAnOrder.mock.calls[0][0];
    expect(orderBody.path).toEqual({ orderID: "order-1" });
    expect(orderBody.body.data).toMatchObject({
      type: "order",
      industry: "Tech",
      marketingOptIn: true,
    });
    // Empty values are dropped before the write.
    expect(orderBody.body.data.vat).toBeUndefined();
  });
});
