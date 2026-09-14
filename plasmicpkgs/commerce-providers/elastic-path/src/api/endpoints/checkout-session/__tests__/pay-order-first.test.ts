/**
 * handlePay — order_first sequence (mock adapter; no Manual implementation).
 *
 * checkoutApi → buildPaymentSetup → paymentSetup. No confirmOrder.
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
  AdapterRegistry,
  SessionStore,
  OrderFirstAdapter,
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
    data: { data: { id: "txn-1", status: "paid", transaction_type: "purchase" } },
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
  });
});
