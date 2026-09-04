/**
 * handleAbandonPayment — unlink the cart PaymentIntent after failed/cancelled 3DS.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() so interception
 * works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  confirmOrder: jest.fn(),
  createCartPaymentIntent: jest.fn(),
  updateCartPaymentIntent: jest.fn(),
  paymentSetup: jest.fn(),
  updateACart: jest.fn(),
  updateAnOrder: jest.fn(),
  deleteACart: jest.fn(),
  manageCarts: jest.fn(),
  deleteACartItem: jest.fn(),
  getByContextAllProducts: jest.fn(),
  createShopperClient: jest.fn(() => ({ client: {} })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  getACart: jest.Mock;
  checkoutApi: jest.Mock;
  confirmOrder: jest.Mock;
  createCartPaymentIntent: jest.Mock;
  updateCartPaymentIntent: jest.Mock;
  updateACart: jest.Mock;
  deleteACart: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleAbandonPayment } = require("../abandon-payment") as {
  handleAbandonPayment: typeof import("../abandon-payment").handleAbandonPayment;
};

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
  PaymentAdapter,
  AdapterRegistry,
  SessionStore,
} from "../../../../checkout/session/types";

const REQUIRES_ACTION_PAYMENT: CheckoutSession["payment"] = {
  gateway: "stripe",
  status: "requires_action",
  clientToken: "pi_abc_secret",
  gatewayMetadata: { paymentIntentId: "pi_abc" },
  actionData: { type: "stripe_3ds", paymentIntentId: "pi_abc" },
};

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-abandon",
    status: "open",
    cartId: "cart-abc",
    cartHash: "hash-1",
    customerInfo: { name: "Jane Doe", email: "jane@example.com" },
    shippingAddress: null,
    billingAddress: null,
    selectedShippingRateId: null,
    availableShippingRates: [],
    totals: null,
    payment: { ...REQUIRES_ACTION_PAYMENT },
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

function createMockAdapter(): PaymentAdapter {
  return {
    initializePayment: jest.fn().mockResolvedValue({ status: "succeeded" }),
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
  overrides: Partial<SessionHandlerContext> = {},
  adapter: PaymentAdapter = createMockAdapter()
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
  epSdk.updateACart.mockResolvedValue({ data: { data: { id: "cart-abc" } } });
});

describe("handleAbandonPayment — guards", () => {
  it("returns 410 when no session exists", async () => {
    const res = await handleAbandonPayment(createMockReq(), createMockCtx(null));
    expect(res.status).toBe(410);
    expect((res.body as any).error.code).toBe("SESSION_GONE");
    expect(epSdk.updateACart).not.toHaveBeenCalled();
  });

  it("returns 400 SESSION_NOT_OPEN when session is complete", async () => {
    const res = await handleAbandonPayment(
      createMockReq(),
      createMockCtx(makeSession({ status: "complete" }))
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("SESSION_NOT_OPEN");
    expect(epSdk.updateACart).not.toHaveBeenCalled();
  });

  it("returns 400 SESSION_NOT_ABANDONABLE when payment is not requires_action", async () => {
    const res = await handleAbandonPayment(
      createMockReq(),
      createMockCtx(
        makeSession({
          payment: {
            ...REQUIRES_ACTION_PAYMENT,
            status: "failed",
          },
        })
      )
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("SESSION_NOT_ABANDONABLE");
    expect(epSdk.updateACart).not.toHaveBeenCalled();
  });

  it("does not clear a succeeded payment", async () => {
    const res = await handleAbandonPayment(
      createMockReq(),
      createMockCtx(
        makeSession({
          status: "complete",
          payment: {
            ...REQUIRES_ACTION_PAYMENT,
            status: "succeeded",
          },
        })
      )
    );
    expect(res.status).toBe(400);
    expect(epSdk.updateACart).not.toHaveBeenCalled();
  });

  it("returns 400 UNKNOWN_GATEWAY for clover", async () => {
    const res = await handleAbandonPayment(
      createMockReq(),
      createMockCtx(
        makeSession({
          payment: { ...REQUIRES_ACTION_PAYMENT, gateway: "clover" },
        })
      )
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("UNKNOWN_GATEWAY");
    expect(epSdk.updateACart).not.toHaveBeenCalled();
  });
});

describe("handleAbandonPayment — success", () => {
  it("clears the cart PI with empty payment_intent_id and resets session 3DS fields", async () => {
    const ctx = createMockCtx(makeSession());
    const res = await handleAbandonPayment(createMockReq(), ctx);

    expect(res.status).toBe(200);
    expect((res.body as any).success).toBe(true);
    const session = (res.body as any).data.session;
    expect(session.status).toBe("open");
    expect(session.payment.status).toBe("failed");
    expect(session.payment.clientToken).toBeNull();
    expect(session.payment.actionData).toBeNull();
    expect(session.payment.gatewayMetadata.paymentIntentId).toBeUndefined();
    expect(session.order).toBeNull();

    expect(epSdk.updateACart).toHaveBeenCalledTimes(1);
    expect(epSdk.updateACart).toHaveBeenCalledWith({
      client: expect.anything(),
      path: { cartID: "cart-abc" },
      body: { data: { payment_intent_id: "" } },
    });
    const body = epSdk.updateACart.mock.calls[0][0].body.data;
    expect(body).toEqual({ payment_intent_id: "" });
    expect(body.custom_attributes).toBeUndefined();

    expect(ctx.sessionStore.set).toHaveBeenCalled();
  });

  it("does not create a PI, updateCartPaymentIntent, checkoutApi, or confirmOrder", async () => {
    await handleAbandonPayment(createMockReq(), createMockCtx(makeSession()));
    expect(epSdk.createCartPaymentIntent).not.toHaveBeenCalled();
    expect(epSdk.updateCartPaymentIntent).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    expect(epSdk.deleteACart).not.toHaveBeenCalled();
  });
});

describe("handleAbandonPayment — EP failure", () => {
  it("returns 502 EP_ERROR and does not persist a reset session when updateACart returns an error", async () => {
    epSdk.updateACart.mockResolvedValue({
      error: { errors: [{ detail: "cannot clear payment intent" }] },
    });
    const ctx = createMockCtx(makeSession());
    const res = await handleAbandonPayment(createMockReq(), ctx);

    expect(res.status).toBe(502);
    expect((res.body as any).success).toBe(false);
    expect((res.body as any).error.code).toBe("EP_ERROR");
    expect((res.body as any).error.message).toMatch(/cannot clear payment intent/i);
    expect(ctx.sessionStore.set).not.toHaveBeenCalled();
  });

  it("returns 502 EP_ERROR and does not persist a reset session when updateACart throws", async () => {
    epSdk.updateACart.mockRejectedValue(new Error("network down"));
    const ctx = createMockCtx(makeSession());
    const res = await handleAbandonPayment(createMockReq(), ctx);

    expect(res.status).toBe(502);
    expect((res.body as any).error.code).toBe("EP_ERROR");
    expect((res.body as any).error.message).toMatch(/network down/i);
    expect(ctx.sessionStore.set).not.toHaveBeenCalled();
  });
});
