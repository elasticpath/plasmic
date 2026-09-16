/**
 * handlePay — order_first sequence (mock adapter + real Manual adapter).
 *
 * checkoutApi → buildPaymentSetup → paymentSetup. No confirmOrder.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() so interception
 * works regardless of import order.
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  getAnOrder: jest.fn(),
  checkoutApi: jest.fn(),
  confirmOrder: jest.fn(),
  createCartPaymentIntent: jest.fn(),
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
  getAnOrder: jest.Mock;
  checkoutApi: jest.Mock;
  confirmOrder: jest.Mock;
  createCartPaymentIntent: jest.Mock;
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
  AdapterRegistry,
  SessionStore,
  OrderFirstAdapter,
} from "../../../../checkout/session/types";
import { hashCart } from "../../../../checkout/session/cart-hash";
import { createAdapterRegistry } from "../../../../checkout/session/adapter-registry";
import { createManualAdapter } from "../../../../checkout/session/adapters/manual-adapter";

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
      {
        id: "rate-standard",
        name: "Standard",
        amount: 500,
        currency: "USD",
        serviceLevel: "standard",
      },
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

function createOrderFirstAdapter(
  setup = { gateway: "manual", method: "purchase" }
): OrderFirstAdapter {
  return {
    paymentSequence: "order_first",
    buildPaymentSetup: jest.fn().mockResolvedValue(setup),
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
  adapter?: PaymentAdapter
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
  };
}

function lastStoredSession(ctx: SessionHandlerContext): CheckoutSession {
  const setMock = ctx.sessionStore.set as jest.Mock;
  return setMock.mock.calls[setMock.mock.calls.length - 1][1] as CheckoutSession;
}

function sessionWithExistingOrder(
  payment: CheckoutSession["payment"],
  orderId = "order-1"
): CheckoutSession {
  return makeSession({
    order: { id: orderId },
    payment,
  });
}


function createManualCtx(session: CheckoutSession | null): SessionHandlerContext {
  const registry = createAdapterRegistry();
  registry.register("manual", createManualAdapter());
  return {
    epCredentials: {
      clientId: "test-id",
      apiBaseUrl: "https://api.test.com",
    },
    adapterRegistry: registry,
    sessionStore: createMockStore(session),
    shopperAccessToken: "shopper-token",
    getClientCredentialsToken: jest.fn(async () => "admin-token"),
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
  epSdk.checkoutApi.mockResolvedValue({
    data: { data: { id: "order-1" } },
  });
  epSdk.confirmOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.paymentSetup.mockResolvedValue({
    data: { data: { id: "txn-1", status: "complete", transaction_type: "purchase" } },
  });
  epSdk.getAnOrder.mockResolvedValue({
    data: { data: { id: "order-1", payment: "unpaid" } },
  });
  epSdk.updateACart.mockResolvedValue({ data: { data: {} } });
  epSdk.updateAnOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.deleteACart.mockResolvedValue({ data: undefined });
  epSdk.manageCarts.mockResolvedValue({});
  epSdk.deleteACartItem.mockResolvedValue({});
});

describe("handlePay — order_first sequence", () => {
  it("checkoutApi before buildPaymentSetup; paymentSetup uses adapter body; no confirmOrder", async () => {
    const adapter = createOrderFirstAdapter({
      gateway: "manual",
      method: "purchase",
    });
    const ctx = createMockCtx(makeSession(), adapter);
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx
    );

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.data.session.status).toBe("complete");
    expect(body.data.session.order?.id).toBe("order-1");
    expect(body.data.session.order?.transactionId).toBe("txn-1");

    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(adapter.buildPaymentSetup).toHaveBeenCalledTimes(1);
    const setupSession = (adapter.buildPaymentSetup as jest.Mock).mock
      .calls[0][0] as CheckoutSession;
    expect(setupSession.order?.id).toBe("order-1");

    const checkoutOrder = epSdk.checkoutApi.mock.invocationCallOrder[0];
    const setupOrder = (adapter.buildPaymentSetup as jest.Mock)
      .mock.invocationCallOrder[0];
    expect(checkoutOrder).toBeLessThan(setupOrder);

    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup.mock.calls[0][0].path).toEqual({
      orderID: "order-1",
    });
    expect(epSdk.paymentSetup.mock.calls[0][0].body.data).toEqual({
      gateway: "manual",
      method: "purchase",
    });
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    expect(epSdk.getAnOrder).not.toHaveBeenCalled();
  });

  it("failed paymentSetup keeps the unpaid order and session open", async () => {
    epSdk.paymentSetup.mockResolvedValue({
      data: { data: { id: "txn-fail", status: "failed" } },
    });
    const adapter = createOrderFirstAdapter();
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(makeSession(), adapter)
    );

    expect(res.status).toBe(200);
    const session = (res.body as any).data.session;
    expect(session.status).toBe("open");
    expect(session.payment.status).toBe("failed");
    expect(session.order?.id).toBe("order-1");
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
  });

  it("requires_action persists client_parameters and keeps the unpaid order", async () => {
    epSdk.paymentSetup.mockResolvedValue({
      data: {
        data: {
          id: "txn-act",
          status: "incomplete",
          client_parameters: { redirect_url: "https://example.test/approve" },
        },
      },
    });
    const adapter = createOrderFirstAdapter();
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(makeSession(), adapter)
    );

    expect(res.status).toBe(200);
    const session = (res.body as any).data.session;
    expect(session.status).toBe("open");
    expect(session.payment.status).toBe("requires_action");
    expect(session.order?.id).toBe("order-1");
    expect(session.payment.actionData).toEqual({
      client_parameters: { redirect_url: "https://example.test/approve" },
    });
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    expect(epSdk.deleteACart).not.toHaveBeenCalled();
  });

  it("cart_payment_intent adapter still does not call paymentSetup", async () => {
    const adapter: PaymentAdapter = {
      paymentSequence: "cart_payment_intent",
      initializePayment: jest.fn().mockResolvedValue({
        status: "succeeded",
        gatewayOrderId: "pi_abc",
        gatewayMetadata: { paymentIntentId: "pi_abc" },
      }),
    };
    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ct" }),
      createMockCtx(makeSession(), adapter)
    );

    expect(res.status).toBe(200);
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(epSdk.confirmOrder).toHaveBeenCalledTimes(1);
    expect(epSdk.getAnOrder).not.toHaveBeenCalled();
  });
});

describe("handlePay — order_first retry / idempotency", () => {
  const failedPayment = {
    gateway: "manual" as const,
    status: "failed" as const,
    clientToken: null,
    gatewayMetadata: {},
    actionData: null,
  };

  it("failed first attempt → retry reuses same order, no second checkoutApi", async () => {
    epSdk.paymentSetup
      .mockResolvedValueOnce({
        data: { data: { id: "txn-fail", status: "failed" } },
      })
      .mockResolvedValueOnce({
        data: {
          data: { id: "txn-2", status: "complete", transaction_type: "purchase" },
        },
      });
    const adapter = createOrderFirstAdapter();
    const ctx1 = createMockCtx(makeSession(), adapter);
    const first = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx1
    );
    expect(first.status).toBe(200);
    expect((first.body as any).data.session.payment.status).toBe("failed");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);

    const stored = lastStoredSession(ctx1);
    const ctx2 = createMockCtx(stored, adapter);
    const second = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx2
    );

    expect(second.status).toBe(200);
    expect((second.body as any).data.session.status).toBe("complete");
    expect((second.body as any).data.session.order?.id).toBe("order-1");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.getAnOrder).toHaveBeenCalledTimes(1);
    expect(epSdk.getAnOrder.mock.calls[0][0].path).toEqual({ orderID: "order-1" });
    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(2);
    expect(epSdk.paymentSetup.mock.calls[1][0].path).toEqual({
      orderID: "order-1",
    });
  });

  it("requires_action first attempt → retry reuses same order", async () => {
    epSdk.paymentSetup
      .mockResolvedValueOnce({
        data: {
          data: {
            id: "txn-act",
            status: "incomplete",
            client_parameters: { redirect_url: "https://example.test/approve" },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: { id: "txn-2", status: "complete", transaction_type: "purchase" },
        },
      });
    const adapter = createOrderFirstAdapter();
    const ctx1 = createMockCtx(makeSession(), adapter);
    const first = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx1
    );
    expect((first.body as any).data.session.payment.status).toBe(
      "requires_action"
    );
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);

    const second = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(lastStoredSession(ctx1), adapter)
    );

    expect(second.status).toBe(200);
    expect((second.body as any).data.session.status).toBe("complete");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup.mock.calls[1][0].path.orderID).toBe("order-1");
  });

  it("buildPaymentSetup() throws → order remains, payment becomes failed, retry reuses order", async () => {
    const adapter = createOrderFirstAdapter();
    (adapter.buildPaymentSetup as jest.Mock)
      .mockRejectedValueOnce(new Error("adapter exploded"))
      .mockResolvedValue({ gateway: "manual", method: "purchase" });

    const ctx1 = createMockCtx(makeSession(), adapter);
    const first = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx1
    );

    expect(first.status).toBe(200);
    const firstSession = (first.body as any).data.session;
    expect(firstSession.status).toBe("open");
    expect(firstSession.payment.status).toBe("failed");
    expect(firstSession.order?.id).toBe("order-1");
    expect((first.body as any).paymentError).toMatch(/adapter exploded/);
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);

    const second = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(lastStoredSession(ctx1), adapter)
    );

    expect(second.status).toBe(200);
    expect((second.body as any).data.session.status).toBe("complete");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup.mock.calls[0][0].path.orderID).toBe("order-1");
  });

  it("cart hash changed → 409, no checkoutApi, no paymentSetup", async () => {
    epSdk.getACart.mockResolvedValue({
      data: {
        included: {
          items: [{ id: "item-new", quantity: 1, unit_price: { amount: 100 } }],
        },
        data: {
          id: "cart-abc",
          meta: { display_price: { with_tax: { amount: 100, currency: "USD" } } },
        },
      },
    });
    const adapter = createOrderFirstAdapter();
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(sessionWithExistingOrder(failedPayment), adapter)
    );

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CART_MISMATCH");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(epSdk.getAnOrder).not.toHaveBeenCalled();
  });

  it("existing order already paid → finalize without second paymentSetup", async () => {
    epSdk.getAnOrder.mockResolvedValue({
      data: { data: { id: "order-1", payment: "paid" } },
    });
    const adapter = createOrderFirstAdapter();
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(sessionWithExistingOrder(failedPayment), adapter)
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect((res.body as any).data.session.order?.id).toBe("order-1");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(adapter.buildPaymentSetup).not.toHaveBeenCalled();
    expect(epSdk.getAnOrder).toHaveBeenCalledTimes(1);
  });

  it("existing order already authorized → finalize without second paymentSetup", async () => {
    epSdk.getAnOrder.mockResolvedValue({
      data: { data: { id: "order-1", payment: "authorized" } },
    });
    const adapter = createOrderFirstAdapter();
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(sessionWithExistingOrder(failedPayment), adapter)
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
  });

  it("getAnOrder failure does not call paymentSetup", async () => {
    epSdk.getAnOrder.mockRejectedValue(new Error("EP get order 500"));
    const adapter = createOrderFirstAdapter();
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      createMockCtx(sessionWithExistingOrder(failedPayment), adapter)
    );

    expect(res.status).toBe(502);
    expect((res.body as any).error.code).toBe("EP_ERROR");
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
  });
});

describe("handlePay — registered Manual adapter", () => {
  it("reaches order-first /pay: checkout before paymentSetup, Manual purchase body, no confirmOrder or Cart PI", async () => {
    const ctx = createManualCtx(makeSession());
    const res = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx
    );

    expect(res.status).toBe(200);
    const session = (res.body as any).data.session;
    expect(session.status).toBe("complete");
    expect(session.order?.id).toBe("order-1");
    expect(session.order?.transactionId).toBe("txn-1");
    expect(session.payment.gateway).toBe("manual");

    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(1);
    const checkoutOrder = epSdk.checkoutApi.mock.invocationCallOrder[0];
    const payOrder = epSdk.paymentSetup.mock.invocationCallOrder[0];
    expect(checkoutOrder).toBeLessThan(payOrder);
    expect(epSdk.paymentSetup.mock.calls[0][0].path).toEqual({
      orderID: "order-1",
    });
    expect(epSdk.paymentSetup.mock.calls[0][0].body.data).toEqual({
      gateway: "manual",
      method: "purchase",
    });
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    expect(epSdk.createCartPaymentIntent).not.toHaveBeenCalled();
    expect(epSdk.getAnOrder).not.toHaveBeenCalled();
    // Manual/order-first must not clear a Cart PaymentIntent association.
    expect(epSdk.updateACart).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: { data: { payment_intent_id: "" } },
      })
    );
    expect(epSdk.deleteACart).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-abc" } })
    );
  });

  it("failed payment keeps the unpaid order and remains retryable on the same order", async () => {
    epSdk.paymentSetup
      .mockResolvedValueOnce({
        data: { data: { id: "txn-fail", status: "failed" } },
      })
      .mockResolvedValueOnce({
        data: {
          data: { id: "txn-2", status: "complete", transaction_type: "purchase" },
        },
      });

    const ctx1 = createManualCtx(makeSession());
    const first = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx1
    );
    expect(first.status).toBe(200);
    const firstSession = (first.body as any).data.session;
    expect(firstSession.status).toBe("open");
    expect(firstSession.payment.status).toBe("failed");
    expect(firstSession.order?.id).toBe("order-1");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    expect(epSdk.createCartPaymentIntent).not.toHaveBeenCalled();

    const ctx2 = createManualCtx(lastStoredSession(ctx1));
    const second = await handlePay(
      createMockReq({ gateway: "manual" }),
      ctx2
    );
    expect(second.status).toBe(200);
    expect((second.body as any).data.session.status).toBe("complete");
    expect((second.body as any).data.session.order?.id).toBe("order-1");
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(2);
    expect(epSdk.paymentSetup.mock.calls[1][0].path.orderID).toBe("order-1");
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    expect(epSdk.createCartPaymentIntent).not.toHaveBeenCalled();
  });
});
