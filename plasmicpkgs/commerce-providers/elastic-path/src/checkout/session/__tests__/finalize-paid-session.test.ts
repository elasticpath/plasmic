jest.mock("@epcc-sdk/sdks-shopper", () => ({
  updateACart: jest.fn(),
  deleteACart: jest.fn(),
  createShopperClient: jest.fn(require("./fake-shopper-client").fakeShopperClient),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  updateACart: jest.Mock;
  deleteACart: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { finalizePaidSession } = require("../finalize-paid-session") as {
  finalizePaidSession: typeof import("../finalize-paid-session").finalizePaidSession;
};

import { EP_ACCOUNT_TOKEN_HEADER } from "../../../auth/ep-plugin/envelope";
import { headersSentBy } from "./fake-shopper-client";
import type {
  CheckoutSession,
  PaymentAdapter,
  SessionHandlerContext,
} from "../types";

const CART_PI_ADAPTER = {
  paymentSequence: "cart_payment_intent",
  initializePayment: jest.fn(),
} as PaymentAdapter;

function makeSession(): CheckoutSession {
  return {
    id: "sess-1",
    status: "processing",
    cartId: "cart-abc",
    cartHash: "hash",
    customerInfo: null,
    shippingAddress: null,
    billingAddress: null,
    selectedShippingRateId: null,
    availableShippingRates: [],
    totals: null,
    payment: {
      gateway: "stripe",
      status: "pending",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: null,
    expiresAt: Date.now() + 60_000,
  };
}

function makeCtx(
  overrides: Partial<SessionHandlerContext> = {}
): SessionHandlerContext {
  return {
    epCredentials: { clientId: "test-id", apiBaseUrl: "https://api.test.com" },
    adapterRegistry: {
      register: jest.fn(),
      getAdapter: jest.fn().mockReturnValue(CART_PI_ADAPTER),
    },
    sessionStore: {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue({ headers: {} }),
      delete: jest.fn(),
    },
    shopperAccessToken: "shopper-token",
    ...overrides,
  };
}

function finalize(ctx: SessionHandlerContext) {
  return finalizePaidSession({
    ctx,
    req: { body: {}, headers: {}, cookies: {} },
    ttl: 1800,
    session: makeSession(),
    gateway: "stripe",
    orderId: "order-1",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  epSdk.updateACart.mockResolvedValue({ data: { data: {} } });
  epSdk.deleteACart.mockResolvedValue({ data: undefined });
});

describe("finalizePaidSession — detaching the cart PaymentIntent", () => {
  it("detaches as the shopper with the selected account's credential when no admin token is available", async () => {
    await finalize(makeCtx({ accountToken: "account-token" }));

    const { client } = epSdk.updateACart.mock.calls[0][0];
    expect(client.token).toBe("shopper-token");
    expect((await headersSentBy(client)).get(EP_ACCOUNT_TOKEN_HEADER)).toBe(
      "account-token"
    );
  });

  it("sends no account credential when no account is selected", async () => {
    await finalize(makeCtx());

    const { client } = epSdk.updateACart.mock.calls[0][0];
    expect((await headersSentBy(client)).has(EP_ACCOUNT_TOKEN_HEADER)).toBe(
      false
    );
  });

  it("keeps the account credential off a client_credentials detach", async () => {
    await finalize(
      makeCtx({
        accountToken: "account-token",
        getClientCredentialsToken: jest.fn(async () => "admin-token"),
      })
    );

    const { client } = epSdk.updateACart.mock.calls[0][0];
    expect(client.token).toBe("admin-token");
    expect((await headersSentBy(client)).has(EP_ACCOUNT_TOKEN_HEADER)).toBe(
      false
    );
  });
});
