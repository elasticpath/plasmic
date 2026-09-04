/**
 * handleResumePayment — Stripe 3DS resume.
 *
 * After /pay stored requires_action, this handler converts the cart to an EP
 * order (or reuses session.order) and confirmOrder-syncs the stored
 * PaymentIntent. It must not create a PI, call updateCartPaymentIntent, or
 * re-assert shipping.
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
  updateAnOrder: jest.Mock;
  deleteACart: jest.Mock;
  manageCarts: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const resumeMod = require("../resume-payment") as {
  handleResumePayment: typeof import("../resume-payment").handleResumePayment;
  classifyConfirmOrderResult: typeof import("../resume-payment").classifyConfirmOrderResult;
};
const { handleResumePayment, classifyConfirmOrderResult } = resumeMod;

import type {
  SessionHandlerContext,
  SessionRequest,
  CheckoutSession,
  PaymentAdapter,
  AdapterRegistry,
  SessionStore,
} from "../../../../checkout/session/types";
import { hashCart } from "../../../../checkout/session/cart-hash";

const CART_ITEMS = [
  { id: "item-1", quantity: 2, unit_price: { amount: 1500 } },
  { id: "item-2", quantity: 1, unit_price: { amount: 2400 } },
];

const REQUIRES_ACTION_PAYMENT: CheckoutSession["payment"] = {
  gateway: "stripe",
  status: "requires_action",
  clientToken: "pi_abc_secret",
  gatewayMetadata: { paymentIntentId: "pi_abc" },
  actionData: { type: "stripe_3ds", paymentIntentId: "pi_abc" },
};

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-resume",
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
      {
        id: "rate-standard",
        name: "Standard",
        amount: 500,
        currency: "USD",
        serviceLevel: "standard",
      },
    ],
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

function createStatefulStore(initial: CheckoutSession | null): SessionStore {
  let current = initial;
  return {
    get: jest.fn(async () => current),
    set: jest.fn(async (_id, session: CheckoutSession) => {
      current = session;
      return { headers: { "Set-Cookie": "ep_cs=test; Path=/" } };
    }),
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
  epSdk.getACart.mockResolvedValue({
    data: {
      included: { items: CART_ITEMS },
      data: {
        id: "cart-abc",
        meta: { display_price: { with_tax: { amount: 5400, currency: "USD" } } },
      },
    },
  });
  epSdk.checkoutApi.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.confirmOrder.mockResolvedValue({
    data: { data: { id: "order-1", payment: "paid" } },
  });
  epSdk.createCartPaymentIntent.mockResolvedValue({ data: { data: {} } });
  epSdk.updateCartPaymentIntent.mockResolvedValue({ data: { data: {} } });
  epSdk.updateAnOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.deleteACart.mockResolvedValue({ data: undefined });
  epSdk.manageCarts.mockResolvedValue({});
});

describe("classifyConfirmOrderResult", () => {
  it("treats a bare { data: { data: { id } } } 200 as unknown, not success", () => {
    expect(
      classifyConfirmOrderResult({ data: { data: { id: "order-1" } } }).outcome
    ).toBe("unknown");
  });

  it("treats an unrecognised nested PI status as unknown", () => {
    expect(
      classifyConfirmOrderResult({
        data: { payment_intent: { status: "requires_source" } },
      }).outcome
    ).toBe("unknown");
  });

  it("treats OrderResponse.payment paid/authorized as succeeded", () => {
    expect(
      classifyConfirmOrderResult({
        data: { data: { id: "order-1", payment: "paid" } },
      }).outcome
    ).toBe("succeeded");
    expect(
      classifyConfirmOrderResult({
        data: { data: { id: "order-1", payment: "authorized" } },
      }).outcome
    ).toBe("succeeded");
  });

  it("treats payment: unpaid as still requires_action", () => {
    expect(
      classifyConfirmOrderResult({
        data: { data: { id: "order-1", payment: "unpaid" } },
      }).outcome
    ).toBe("requires_action");
  });

  it("classifies nested payment_intent.status requires_action / canceled / succeeded", () => {
    expect(
      classifyConfirmOrderResult({
        data: { payment_intent: { status: "requires_action" } },
      }).outcome
    ).toBe("requires_action");
    expect(
      classifyConfirmOrderResult({
        data: { payment_intent: { status: "canceled" } },
      }).outcome
    ).toBe("failed");
    expect(
      classifyConfirmOrderResult({
        data: { payment_intent: { status: "succeeded" } },
      }).outcome
    ).toBe("succeeded");
  });

  it("classifies thrown errors from confirmOrder text", () => {
    expect(
      classifyConfirmOrderResult(undefined, new Error("requires_action"))
        .outcome
    ).toBe("requires_action");
    expect(
      classifyConfirmOrderResult(undefined, new Error("PaymentIntent canceled"))
        .outcome
    ).toBe("failed");
    expect(
      classifyConfirmOrderResult(undefined, new Error("requires_payment_method"))
        .outcome
    ).toBe("failed");
    expect(
      classifyConfirmOrderResult(undefined, new Error("EP 500 boom")).outcome
    ).toBe("unknown");
  });

  it("classifies an SDK result.error without a payment-status signal as unknown", () => {
    expect(
      classifyConfirmOrderResult({ error: { message: "EP 500 boom" } }).outcome
    ).toBe("unknown");
  });
});

describe("handleResumePayment — guards", () => {
  it("returns 410 SESSION_GONE when no session exists", async () => {
    const res = await handleResumePayment(createMockReq(), createMockCtx(null));
    expect(res.status).toBe(410);
    expect((res.body as any).error.code).toBe("SESSION_GONE");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
  });

  it("returns 400 SESSION_NOT_OPEN when session is complete", async () => {
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession({ status: "complete" }))
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("SESSION_NOT_OPEN");
  });

  it("returns 400 SESSION_NOT_RESUMABLE when payment is not requires_action", async () => {
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(
        makeSession({
          payment: {
            ...REQUIRES_ACTION_PAYMENT,
            status: "idle",
          },
        })
      )
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("SESSION_NOT_RESUMABLE");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
  });

  it("returns 400 UNKNOWN_GATEWAY for a non-stripe gateway", async () => {
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(
        makeSession({
          payment: { ...REQUIRES_ACTION_PAYMENT, gateway: "clover" },
        })
      )
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("UNKNOWN_GATEWAY");
  });

  it("returns 400 NO_PAYMENT_INTENT when gatewayMetadata.paymentIntentId is missing", async () => {
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(
        makeSession({
          payment: {
            ...REQUIRES_ACTION_PAYMENT,
            gatewayMetadata: {},
          },
        })
      )
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("NO_PAYMENT_INTENT");
  });

  it("does not trust a client-provided payment status", async () => {
    const res = await handleResumePayment(
      createMockReq({
        payment: { status: "succeeded" },
        gateway: "clover",
      }),
      createMockCtx(
        makeSession({
          payment: {
            ...REQUIRES_ACTION_PAYMENT,
            status: "idle",
            gateway: "stripe",
          },
        })
      )
    );
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("SESSION_NOT_RESUMABLE");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
  });

  it("returns 409 CART_MISMATCH when the cart has changed", async () => {
    epSdk.getACart.mockResolvedValue({
      data: { included: { items: [{ id: "different", quantity: 99 }] } },
    });
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession())
    );
    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CART_MISMATCH");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
  });

  it("does not rewrite the stored cartHash on mismatch; a second resume still 409s", async () => {
    const originalHash = hashCart(CART_ITEMS);
    const mutatedItems = [{ id: "different", quantity: 99 }];
    const store = createStatefulStore(makeSession());
    const ctx = createMockCtx(makeSession(), { sessionStore: store });
    epSdk.getACart.mockResolvedValue({
      data: { included: { items: mutatedItems } },
    });

    const first = await handleResumePayment(createMockReq(), ctx);
    expect(first.status).toBe(409);
    expect((first.body as any).error.code).toBe("CART_MISMATCH");
    expect((await store.get("current"))?.cartHash).toBe(originalHash);
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();

    const second = await handleResumePayment(createMockReq(), ctx);
    expect(second.status).toBe(409);
    expect((second.body as any).error.code).toBe("CART_MISMATCH");
    expect((await store.get("current"))?.cartHash).toBe(originalHash);
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
  });
});

describe("handleResumePayment — success", () => {
  it("checkoutApi → confirmOrder → cleanup → session complete", async () => {
    const adapter = createMockAdapter();
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession(), {}, adapter)
    );

    expect(res.status).toBe(200);
    const session = (res.body as any).data.session;
    expect(session.status).toBe("complete");
    expect(session.payment.status).toBe("succeeded");
    expect(session.order?.id).toBe("order-1");
    expect(session.payment.gatewayMetadata).toMatchObject({
      paymentIntentId: "pi_abc",
    });

    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.checkoutApi.mock.calls[0][0].path).toEqual({
      cartID: "cart-abc",
    });
    expect(epSdk.confirmOrder).toHaveBeenCalledTimes(1);
    expect(epSdk.confirmOrder.mock.calls[0][0].path).toEqual({
      orderID: "order-1",
      paymentID: "pi_abc",
    });
    expect(epSdk.deleteACart).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-abc" } })
    );
  });

  it("does not create another PaymentIntent or call updateCartPaymentIntent", async () => {
    const adapter = createMockAdapter();
    await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession(), {}, adapter)
    );
    expect(epSdk.createCartPaymentIntent).not.toHaveBeenCalled();
    expect(epSdk.updateCartPaymentIntent).not.toHaveBeenCalled();
    expect(epSdk.updateACart).not.toHaveBeenCalled();
    expect(adapter.initializePayment).not.toHaveBeenCalled();
    expect(adapter.confirmPayment).not.toHaveBeenCalled();
  });

  it("does not re-apply shipping", async () => {
    await handleResumePayment(createMockReq(), createMockCtx(makeSession()));
    expect(epSdk.manageCarts).not.toHaveBeenCalled();
  });

  it("reuses session.order instead of calling checkoutApi", async () => {
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession({ order: { id: "order-existing" } }))
    );
    expect(res.status).toBe(200);
    expect((res.body as any).data.session.order?.id).toBe("order-existing");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder.mock.calls[0][0].path).toEqual({
      orderID: "order-existing",
      paymentID: "pi_abc",
    });
  });
});

describe("handleResumePayment — pending / still requires_action", () => {
  it("keeps the session open, does not complete, and skips cleanup", async () => {
    epSdk.confirmOrder.mockResolvedValue({
      data: { data: { id: "order-1", payment: "unpaid" } },
    });

    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession())
    );

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_STILL_REQUIRES_ACTION");
    const session = (res.body as any).data.session;
    expect(session.status).toBe("open");
    expect(session.payment.status).toBe("requires_action");
    expect(session.order?.id).toBe("order-1");
    expect(epSdk.deleteACart).not.toHaveBeenCalled();
    expect(epSdk.createCartPaymentIntent).not.toHaveBeenCalled();
  });

  it("returns 409 when confirmOrder throws a requires_action error", async () => {
    epSdk.confirmOrder.mockRejectedValue(new Error("requires_action"));
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession())
    );
    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("PAYMENT_STILL_REQUIRES_ACTION");
    expect((res.body as any).data.session.status).toBe("open");
    expect((res.body as any).data.session.payment.status).toBe(
      "requires_action"
    );
    expect((res.body as any).data.session.order?.id).toBe("order-1");
    expect(epSdk.deleteACart).not.toHaveBeenCalled();
  });
});

describe("handleResumePayment — unknown confirmOrder error", () => {
  it("returns 502 EP_ERROR on a thrown confirmOrder error and preserves the order", async () => {
    const store = createStatefulStore(makeSession());
    const ctx = createMockCtx(makeSession(), { sessionStore: store });
    epSdk.confirmOrder.mockRejectedValue(new Error("EP confirm 500"));

    const res = await handleResumePayment(createMockReq(), ctx);

    expect(res.status).toBe(502);
    expect((res.body as any).error.code).toBe("EP_ERROR");
    expect((res.body as any).error.code).not.toBe("PAYMENT_STILL_REQUIRES_ACTION");
    expect((res.body as any).data?.session).toBeUndefined();
    expect(epSdk.deleteACart).not.toHaveBeenCalled();

    const stored = await store.get("current");
    expect(stored?.status).toBe("open");
    expect(stored?.payment.status).toBe("requires_action");
    expect(stored?.order?.id).toBe("order-1");
  });

  it("returns 502 EP_ERROR on an SDK result.error and preserves the order", async () => {
    const store = createStatefulStore(
      makeSession({ order: { id: "order-existing" } })
    );
    const ctx = createMockCtx(
      makeSession({ order: { id: "order-existing" } }),
      { sessionStore: store }
    );
    epSdk.confirmOrder.mockResolvedValue({
      error: { message: "EP 500 boom" },
    });

    const res = await handleResumePayment(createMockReq(), ctx);

    expect(res.status).toBe(502);
    expect((res.body as any).error.code).toBe("EP_ERROR");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.deleteACart).not.toHaveBeenCalled();

    const stored = await store.get("current");
    expect(stored?.status).toBe("open");
    expect(stored?.payment.status).toBe("requires_action");
    expect(stored?.order?.id).toBe("order-existing");
  });

  it("returns 502 EP_ERROR on a bare confirmOrder { id } 200 (unrecognised success)", async () => {
    const store = createStatefulStore(makeSession());
    const ctx = createMockCtx(makeSession(), { sessionStore: store });
    epSdk.confirmOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });

    const res = await handleResumePayment(createMockReq(), ctx);

    expect(res.status).toBe(502);
    expect((res.body as any).error.code).toBe("EP_ERROR");
    expect((res.body as any).error.code).not.toBe(
      "PAYMENT_STILL_REQUIRES_ACTION"
    );
    expect(epSdk.deleteACart).not.toHaveBeenCalled();

    const stored = await store.get("current");
    expect(stored?.status).toBe("open");
    expect(stored?.payment.status).toBe("requires_action");
    expect(stored?.order?.id).toBe("order-1");
  });
});

describe("handleResumePayment — failed / cancelled PaymentIntent", () => {
  it("marks payment failed, keeps session open, and does not complete", async () => {
    epSdk.confirmOrder.mockRejectedValue(
      new Error("PaymentIntent canceled")
    );

    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession())
    );

    expect(res.status).toBe(200);
    const session = (res.body as any).data.session;
    expect(session.status).toBe("open");
    expect(session.payment.status).toBe("failed");
    expect(session.order?.id).toBe("order-1");
    expect(epSdk.deleteACart).not.toHaveBeenCalled();
    expect(epSdk.createCartPaymentIntent).not.toHaveBeenCalled();
  });

  it("treats nested canceled payment_intent.status as failed", async () => {
    epSdk.confirmOrder.mockResolvedValue({
      data: { payment_intent: { status: "canceled" } },
    });
    const res = await handleResumePayment(
      createMockReq(),
      createMockCtx(makeSession())
    );
    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("open");
    expect((res.body as any).data.session.payment.status).toBe("failed");
    expect((res.body as any).data.session.order?.id).toBe("order-1");
  });
});

describe("handleResumePayment — order reuse after confirm failure", () => {
  it("reuses session.order on retry instead of creating a second order", async () => {
    const store = createStatefulStore(makeSession());
    const ctx = createMockCtx(makeSession(), { sessionStore: store });

    epSdk.confirmOrder.mockRejectedValueOnce(new Error("EP confirm 500"));
    const first = await handleResumePayment(createMockReq(), ctx);
    expect(first.status).toBe(502);
    expect((first.body as any).error.code).toBe("EP_ERROR");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect((await store.get("current"))?.order?.id).toBe("order-1");

    epSdk.confirmOrder.mockResolvedValue({
      data: { data: { id: "order-1", payment: "paid" } },
    });
    const second = await handleResumePayment(createMockReq(), ctx);

    expect(second.status).toBe(200);
    expect((second.body as any).data.session.status).toBe("complete");
    expect((second.body as any).data.session.order?.id).toBe("order-1");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.confirmOrder).toHaveBeenCalledTimes(2);
    expect(epSdk.confirmOrder.mock.calls[1][0].path.orderID).toBe("order-1");
  });
});
