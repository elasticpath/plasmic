/**
 * Checkout-session security regression suite (#325).
 *
 * This file is the designated *home + harness* for the checkout pipeline's
 * security invariants. Two kinds of assertion live here:
 *
 *   1. Always-true boundary guards (purely additive, no production change):
 *      - admin / client-credentials and shopper tokens never reflect into a
 *        session response, across every checkout-session route — including
 *        #368's new branches (the order-custom-fields write and the
 *        free-order settlement path);
 *      - no PII (customAttributes values, customer contact details) is ever
 *        written to the logs.
 *
 *   2. Integrity assertions that land *red alongside their fix* (TDD):
 *      - free-vs-paid server authority (#369 HIGH): a paid cart must never
 *        settle for free when its authoritative total is unavailable.
 *      Session-ownership / order-fields allow-list land here as their
 *      production fixes arrive.
 *
 * esbuild does not hoist jest.mock(); we require() the handlers so SDK
 * interception works regardless of import order (matches the sibling
 * pay-single-shot suite).
 */

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: jest.fn(),
  checkoutApi: jest.fn(),
  confirmOrder: jest.fn(),
  confirmPayment: jest.fn(),
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
  confirmPayment: jest.Mock;
  paymentSetup: jest.Mock;
  updateACart: jest.Mock;
  updateAnOrder: jest.Mock;
  deleteACart: jest.Mock;
  manageCarts: jest.Mock;
  deleteACartItem: jest.Mock;
  getByContextAllProducts: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handlePay } = require("../pay") as {
  handlePay: typeof import("../pay").handlePay;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleConfirm } = require("../confirm") as {
  handleConfirm: typeof import("../confirm").handleConfirm;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleCreateSession } = require("../create-session") as {
  handleCreateSession: typeof import("../create-session").handleCreateSession;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleGetSession } = require("../get-session") as {
  handleGetSession: typeof import("../get-session").handleGetSession;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleUpdateSession } = require("../update-session") as {
  handleUpdateSession: typeof import("../update-session").handleUpdateSession;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleCalculateShipping } = require("../calculate-shipping") as {
  handleCalculateShipping: typeof import("../calculate-shipping").handleCalculateShipping;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resetLogConfig } = require("../../../../utils/logger") as {
  resetLogConfig: typeof import("../../../../utils/logger").resetLogConfig;
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

// ---------------------------------------------------------------------------
// Sentinels — distinctive strings that must NEVER surface in a response body
// or in the logs. Picked so an accidental leak is unambiguous in a diff.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = "ADMIN-CC-TOKEN-must-never-leak-9f3a";
const SHOPPER_TOKEN = "SHOPPER-TOKEN-must-never-leak-7b21";
const PII_PHONE = "SECRET-PHONE-+41-00-000-0000";
const PII_VAT = "SECRET-VAT-CHE-999999999";
const PII_EMAIL = "secret.shopper@example-pii.test";
const PII_NAME = "Pii Sentinel-Surname";

const PRICED_ITEMS = [
  { id: "item-1", quantity: 2, unit_price: { amount: 1500 } },
  { id: "item-2", quantity: 1, unit_price: { amount: 2400 } },
];

/** A cart response whose `meta.display_price` carries an authoritative total. */
function cartResponseWithTotal(
  amount: number,
  items: Array<Record<string, unknown>> = PRICED_ITEMS
) {
  return {
    data: {
      included: { items },
      data: {
        meta: { display_price: { with_tax: { amount, currency: "CHF" } } },
      },
    },
  };
}

// A shipping cart's default state is realistic: the selected rate id exists in
// the server-computed available set (a selection is made FROM that list). The
// handler fails closed if shipping is required but no rate resolves, so tests
// that complete a shipping order must carry the computed rate, not an empty set.
const DEFAULT_RATES = [
  { id: "rate-standard", name: "Standard", amount: 500, currency: "CHF", serviceLevel: "standard", carrier: "DHL" },
];

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-sec",
    status: "open",
    cartId: "cart-abc",
    cartHash: hashCart(PRICED_ITEMS),
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
    availableShippingRates: DEFAULT_RATES,
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
  },
  confirmResult: PaymentAdapterResult = { status: "succeeded" }
): PaymentAdapter {
  return {
    initializePayment: jest.fn().mockResolvedValue(initResult),
    confirmPayment: jest.fn().mockResolvedValue(confirmResult),
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
    shopperAccessToken: SHOPPER_TOKEN,
    getClientCredentialsToken: jest.fn(async () => ADMIN_TOKEN),
    ...overrides,
  };
}

function createMockReq(body: Record<string, unknown> = {}): SessionRequest {
  return { body, headers: {}, cookies: {} };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: a priced cart with an authoritative non-zero total.
  epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
  epSdk.checkoutApi.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.confirmOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.confirmPayment.mockResolvedValue({ data: { data: { id: "txn-1" } } });
  epSdk.paymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });
  epSdk.updateACart.mockResolvedValue({ data: { data: {} } });
  epSdk.updateAnOrder.mockResolvedValue({ data: { data: { id: "order-1" } } });
  epSdk.deleteACart.mockResolvedValue({ data: undefined });
  epSdk.getByContextAllProducts.mockResolvedValue({ data: { data: [] } });
  epSdk.manageCarts.mockResolvedValue({});
  epSdk.deleteACartItem.mockResolvedValue({});
});

// ===========================================================================
// 1. Free-vs-paid server authority (#369 HIGH) — RED alongside its fix.
// ===========================================================================

describe("free-vs-paid server authority (#369)", () => {
  it("refuses to free-settle a paid cart when the authoritative total is unavailable", async () => {
    // The latent bug: a parse failure present at BOTH session-create and pay
    // hashes identically (no 409 guard fires), and the cart response carries
    // no `meta.display_price` total. The old code summed the unparseable items
    // to 0 and routed to the manual free-settlement gateway — a cart that
    // actually costs money settling with NO charge.
    //
    // Server is the sole authority on free-vs-paid: with no authoritative
    // zero, the handler MUST NOT free-settle.
    const UNPARSEABLE_ITEMS = [{ id: "item-x", quantity: 1 }]; // no price fields
    epSdk.getACart.mockResolvedValue({
      // NOTE: no data.meta.display_price → cartMetaTotal is null.
      data: { included: { items: UNPARSEABLE_ITEMS } },
    });
    const ctx = createMockCtx(
      // requiresShipping:false isolates this from the shipping re-assertion —
      // the assertion under test is the free-vs-paid authority, not shipping.
      makeSession({ cartHash: hashCart(UNPARSEABLE_ITEMS), requiresShipping: false })
    );
    // A free checkout sends no gateway / confirmation_token.
    const res = await handlePay(createMockReq({}), ctx);

    // Money teeth: the manual free-settlement path must NOT run, and no order
    // may be created for free.
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();

    // The cart must NOT complete as a free order; the handler fails closed.
    const body = res.body as any;
    expect(body?.data?.session?.status).not.toBe("complete");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("still settles a genuinely free cart (authoritative meta total 0) via the manual gateway", async () => {
    // Must-not-break: a real CHF 0 cart has `meta.display_price` present and
    // exactly 0 → it still settles for free with no card.
    const FREE_ITEMS = [{ id: "free-1", quantity: 1 }];
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(0, FREE_ITEMS));
    // A genuinely free order is digital here (no shipping to assert).
    const ctx = createMockCtx(
      makeSession({ cartHash: hashCart(FREE_ITEMS), requiresShipping: false })
    );

    const res = await handlePay(createMockReq({}), ctx);

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup.mock.calls[0][0].body.data).toEqual({
      gateway: "manual",
      method: "purchase",
    });
  });

  it("charges a paid cart (authoritative non-zero total) via the gateway adapter, not free settlement", async () => {
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(makeSession(), adapter);

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect(adapter.initializePayment).toHaveBeenCalledTimes(1);
    // Paid path — NOT the manual free-settlement gateway.
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 1b. Order-fields allow-list (#369) — RED alongside its fix.
//     customAttributes are the client-supplied non-reserved form fields. They
//     are written to the cart's custom_attributes AND forwarded to the order's
//     flow fields, where EP persists any slug its flow defines. Without a gate
//     a client can forge/overwrite ANY defined order-flow slug (consent flags,
//     internal/audit fields the form never exposes) just by sending it. The
//     server-side allow-list is the gate: fail closed (no list → nothing
//     persists), strict when a list is set, explicit "*" to opt into open.
// ===========================================================================

describe("order-fields allow-list (#369)", () => {
  it("drops a forged custom-attribute key not on the allow-list (cart + order writes)", async () => {
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(
      // industry is a legitimate form field; kyc_verified is a forged
      // order-flow slug the form never exposes.
      makeSession({ customAttributes: { industry: "Tech", kyc_verified: true } }),
      adapter,
      { allowedCustomAttributeKeys: ["industry"] }
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );
    expect(res.status).toBe(200);

    // Cart custom_attributes write carries only the allow-listed key.
    const cartAttrs =
      epSdk.updateACart.mock.calls[0][0].body.data.custom_attributes;
    expect(cartAttrs.industry).toBeDefined();
    expect(cartAttrs.kyc_verified).toBeUndefined();

    // Order flow-field write carries only the allow-listed key.
    const orderData = epSdk.updateAnOrder.mock.calls[0][0].body.data;
    expect(orderData.industry).toBe("Tech");
    expect(orderData.kyc_verified).toBeUndefined();
  });

  it("fails closed: with no allow-list configured, no custom attributes are persisted", async () => {
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(
      makeSession({ customAttributes: { industry: "Tech" } }),
      adapter
      // no allowedCustomAttributeKeys → fail closed
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );
    // The order still completes; the extras are simply dropped.
    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    // Nothing to persist → neither write fires.
    expect(epSdk.updateACart).not.toHaveBeenCalled();
    expect(epSdk.updateAnOrder).not.toHaveBeenCalled();
  });

  it('the "*" sentinel opts into persisting arbitrary keys (deliberate permissive mode)', async () => {
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(
      makeSession({ customAttributes: { anything: "goes", another: 1 } }),
      adapter,
      { allowedCustomAttributeKeys: "*" }
    );

    await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    const orderData = epSdk.updateAnOrder.mock.calls[0][0].body.data;
    expect(orderData.anything).toBe("goes");
    expect(orderData.another).toBe(1);
  });

  it("enforces the allow-list at the update-session boundary (forged key never enters the session)", async () => {
    const ctx = createMockCtx(makeSession({ customAttributes: {} }), undefined, {
      allowedCustomAttributeKeys: ["industry"],
    });
    const res = await handleUpdateSession(
      createMockReq({ customAttributes: { industry: "Tech", kyc_verified: true } }),
      ctx
    );

    expect(res.status).toBe(200);
    const stored = (res.body as any).data.session.customAttributes;
    expect(stored).toEqual({ industry: "Tech" }); // forged key dropped on entry
    // And the persisted session matches (no forged key in stored state).
    const persisted = (ctx.sessionStore.set as jest.Mock).mock.calls[0][1];
    expect(persisted.customAttributes.kyc_verified).toBeUndefined();
  });
});

// ===========================================================================
// 1c. confirmOrder reconciliation (#369) — RED alongside its fix.
//     After a paid order is created, confirmOrder syncs the gateway payment
//     status onto the EP order. The customer is ALREADY charged at this point,
//     so a failure must not lose their order — but it must NOT be swallowed
//     either: a charged-but-unreconciled order has to be flagged durably so it
//     can be reconciled, not silently reported as a clean success.
// ===========================================================================

describe("confirmOrder reconciliation (#369)", () => {
  it("flags needsReconciliation (not a silent success) when confirmOrder fails", async () => {
    epSdk.confirmOrder.mockRejectedValue(new Error("EP confirmOrder 500"));
    const adapter = createMockAdapter({
      status: "succeeded",
      gatewayOrderId: "pi_abc",
      gatewayMetadata: { paymentIntentId: "pi_abc" },
    });
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(makeSession(), adapter);

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    const body = res.body as any;
    // The order is genuine + paid → still completes.
    expect(res.status).toBe(200);
    expect(body.data.session.status).toBe("complete");
    expect(body.data.session.order?.id).toBe("order-1");
    // ...but the reconciliation gap is surfaced, not swallowed.
    expect(body.reconciliationPending).toBe(true);
    expect(body.data.session.payment.gatewayMetadata.needsReconciliation).toBe(
      true
    );
  });

  it("does not call confirmOrder with an undefined paymentID; flags reconciliation instead", async () => {
    // Adapter succeeded but returned no gateway order id / payment intent id.
    const adapter = createMockAdapter({ status: "succeeded" });
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(makeSession(), adapter);

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    const body = res.body as any;
    expect(res.status).toBe(200);
    expect(body.data.session.status).toBe("complete");
    // We must not fire a meaningless confirmOrder with paymentID=undefined.
    expect(epSdk.confirmOrder).not.toHaveBeenCalled();
    // The missing payment id is itself a reconciliation gap.
    expect(body.reconciliationPending).toBe(true);
    expect(body.data.session.payment.gatewayMetadata.needsReconciliation).toBe(
      true
    );
  });

  it("clean confirmOrder → no reconciliation flag (no false positives)", async () => {
    const adapter = createMockAdapter({
      status: "succeeded",
      gatewayOrderId: "pi_ok",
      gatewayMetadata: { paymentIntentId: "pi_ok" },
    });
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(makeSession(), adapter);

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    const body = res.body as any;
    expect(res.status).toBe(200);
    expect(epSdk.confirmOrder).toHaveBeenCalledTimes(1);
    expect(epSdk.confirmOrder.mock.calls[0][0].path.paymentID).toBe("pi_ok");
    expect(body.reconciliationPending).toBeUndefined();
    expect(
      body.data.session.payment.gatewayMetadata.needsReconciliation
    ).toBeUndefined();
  });
});

// ===========================================================================
// 1d. Server-authoritative requiresShipping (#369) — RED alongside its fix.
//     EP requires a shipping address on every checkout (the body builder
//     defaults it to billing), so a client setting requiresShipping:false on a
//     PHYSICAL cart would ship to billing silently. The server infers the
//     requirement from the cart's physical items; the client flag may only ADD
//     it, never suppress it.
// ===========================================================================

describe("server-authoritative requiresShipping (#369)", () => {
  /** Cart whose single line points at the given product id. */
  function physicalCartFetch(productId: string, commodityType: string) {
    const items = [{ id: "li-1", quantity: 1, product_id: productId }];
    epSdk.getACart.mockResolvedValue({
      data: {
        included: { items },
        data: {
          meta: { display_price: { with_tax: { amount: 5400, currency: "CHF" } } },
        },
      },
    });
    epSdk.getByContextAllProducts.mockResolvedValue({
      data: { data: [{ id: productId, attributes: { commodity_type: commodityType } }] },
    });
    return hashCart(items);
  }

  it("forces shipping for a physical cart even when the client suppressed it", async () => {
    const cartHash = physicalCartFetch("prod-phys", "physical");
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        cartHash,
        requiresShipping: false, // client tries to suppress
        shippingAddress: null,
        selectedShippingRateId: null,
      }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("MISSING_FIELDS");
    expect((res.body as any).error.message).toContain("shippingAddress");
    // No payment attempted, no order created.
    expect(adapter.initializePayment).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
  });

  it("honours suppression for a digital-only cart", async () => {
    const cartHash = physicalCartFetch("prod-dig", "digital");
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        cartHash,
        requiresShipping: false,
        shippingAddress: null,
        selectedShippingRateId: null,
      }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    expect(adapter.initializePayment).toHaveBeenCalledTimes(1);
  });

  it("proceeds for a physical cart when a real shipping address + rate were provided", async () => {
    const cartHash = physicalCartFetch("prod-phys", "physical");
    const adapter = createMockAdapter();
    // requiresShipping:false but a genuine shipping address + rate are present
    // (makeSession defaults them) → the requirement is satisfied.
    const ctx = createMockCtx(
      makeSession({ cartHash, requiresShipping: false }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
  });

  it("does not look up products when shipping isn't suppressed (no extra call)", async () => {
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const adapter = createMockAdapter();
    const ctx = createMockCtx(makeSession(), adapter); // requiresShipping undefined

    await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(epSdk.getByContextAllProducts).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 1e. Authoritative shipping re-assertion (setShippingLine slice #4).
//     The cart is shopper-mutable, so a shipping line written during checkout
//     can be lowered or stripped before pay. handlePay re-resolves the selected
//     rate server-side (from session.availableShippingRates — the client cannot
//     supply an amount) and re-writes the line BEFORE the charge, so the
//     charged shipping is always the server's recomputation, never the cart
//     line as-found (ADR-0013).
// ===========================================================================

const SHIPPING_RATES = [
  { id: "rate-standard", name: "Standard", amount: 500, currency: "CHF", serviceLevel: "standard", carrier: "DHL" },
  { id: "rate-express", name: "Express", amount: 1500, currency: "CHF", serviceLevel: "express", carrier: "DHL" },
];
const SHIP_SKU = "__ep_shipping";

/** Cart fetch carrying the given items + an authoritative meta total. */
function cartFetch(items: Array<Record<string, unknown>>, total: number) {
  return {
    data: {
      included: { items },
      data: { meta: { display_price: { with_tax: { amount: total, currency: "CHF" } } } },
    },
  };
}

describe("authoritative shipping re-assertion (setShippingLine #4)", () => {
  it("re-writes a TAMPERED (lowered) shipping line to the server amount before charging", async () => {
    // The shopper lowered their shipping line to 1 minor unit. The hash still
    // matches (the managed line is excluded from the hash), so no 409 fires —
    // the re-assertion is what must defend the charge.
    const tampered = [
      ...PRICED_ITEMS,
      { id: "ship-old", sku: SHIP_SKU, quantity: 1, unit_price: { amount: 1 } },
    ];
    epSdk.getACart.mockResolvedValue(cartFetch(tampered, 5401));
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        cartHash: hashCart(PRICED_ITEMS), // managed line excluded → unchanged
        availableShippingRates: SHIPPING_RATES,
        selectedShippingRateId: "rate-standard",
      }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    // The tampered line was cleared...
    expect(epSdk.deleteACartItem).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-abc", cartitemID: "ship-old" } })
    );
    // ...and replaced with the SERVER amount for the selected id (500), not 1.
    const written = epSdk.manageCarts.mock.calls[0][0].body.data;
    expect(written.sku).toBe(SHIP_SKU);
    expect(written.price.amount).toBe(500);
    // The charge runs against the re-written cart.
    expect(adapter.initializePayment).toHaveBeenCalledTimes(1);
  });

  it("ignores any client-supplied shipping amount — only the selected rate id is honoured", async () => {
    epSdk.getACart.mockResolvedValue(cartFetch(PRICED_ITEMS, 5400));
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        availableShippingRates: SHIPPING_RATES,
        selectedShippingRateId: "rate-express",
      }),
      adapter
    );

    // A hostile client stuffs a cheap shipping amount into the pay body.
    const res = await handlePay(
      createMockReq({
        gateway: "stripe",
        confirmation_token: "ctok",
        shippingAmount: 1,
        amount: 1,
        price: { amount: 1 },
      }),
      ctx
    );

    expect(res.status).toBe(200);
    // The written shipping amount is the SERVER rate (1500), never the client 1.
    expect(epSdk.manageCarts.mock.calls[0][0].body.data.price.amount).toBe(1500);
  });

  it("never free-ships: a stripped line on a free-product cart is re-asserted and routed to the paid path", async () => {
    // Free product, shipping line stripped → the cart's authoritative total is
    // 0 at fetch. Without re-assertion this would settle for FREE via the
    // manual gateway. Re-asserting shipping makes the total non-zero, so it
    // must route to the paid path (gateway required) — never a free order.
    const FREE_ITEMS = [{ id: "free-1", quantity: 1 }];
    let call = 0;
    epSdk.getACart.mockImplementation(async () => {
      call += 1;
      // Call 1 = pay's hash/total fetch (stripped → total 0).
      if (call === 1) return cartFetch(FREE_ITEMS, 0);
      // Subsequent reads (setCartShippingLine + the post-reassert recompute)
      // see the re-written shipping line → non-zero total.
      return cartFetch(
        [...FREE_ITEMS, { id: "ship-new", sku: SHIP_SKU, quantity: 1, unit_price: { amount: 500 } }],
        500
      );
    });
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        cartHash: hashCart(FREE_ITEMS),
        availableShippingRates: SHIPPING_RATES,
        selectedShippingRateId: "rate-standard",
      }),
      adapter
    );

    // A free checkout attempt sends no gateway.
    const res = await handlePay(createMockReq({}), ctx);

    // Shipping was re-written...
    expect(epSdk.manageCarts).toHaveBeenCalledTimes(1);
    expect(epSdk.manageCarts.mock.calls[0][0].body.data.price.amount).toBe(500);
    // ...and the cart did NOT settle for free: no manual settlement, no order.
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((res.body as any).data?.session?.status).not.toBe("complete");
  });

  it("409s when the selected rate is no longer offered (irreconcilable), never charging", async () => {
    epSdk.getACart.mockResolvedValue(cartFetch(PRICED_ITEMS, 5400));
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        availableShippingRates: SHIPPING_RATES,
        selectedShippingRateId: "rate-gone", // not in the server-computed set
      }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("SHIPPING_RATE_UNRESOLVABLE");
    // No write, no charge, no order.
    expect(epSdk.manageCarts).not.toHaveBeenCalled();
    expect(adapter.initializePayment).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
  });

  it("fails closed (409) when shipping is required but no rates were ever computed — never a free ship", async () => {
    // VULN-001 regression: a shipping-required cart that reaches pay without
    // calculate-shipping having run (availableShippingRates empty) must NOT
    // silently skip the shipping charge. The selection cannot resolve → 409,
    // and nothing is charged.
    epSdk.getACart.mockResolvedValue(cartFetch(PRICED_ITEMS, 5400));
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({ availableShippingRates: [], selectedShippingRateId: "rate-standard" }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("SHIPPING_RATE_UNRESOLVABLE");
    expect(epSdk.manageCarts).not.toHaveBeenCalled();
    expect(adapter.initializePayment).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
  });

  it("does not leak the admin token through the shipping re-assertion write", async () => {
    epSdk.getACart.mockResolvedValue(cartFetch(PRICED_ITEMS, 5400));
    const adapter = createMockAdapter();
    const ctx = createMockCtx(
      makeSession({
        availableShippingRates: SHIPPING_RATES,
        selectedShippingRateId: "rate-standard",
      }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(epSdk.manageCarts).toHaveBeenCalledTimes(1); // the credentialed write ran
    expectNoTokenLeak(res);
  });
});

// ===========================================================================
// 1f. Studio extension API — applyCartAdjustment money integrity (#371).
//     A tenant designer can inject a labelled fee into the EP cart from a
//     server query (ep.applyCartAdjustment → a custom_item line). The trust
//     invariant (ADR "EP cart is the sole authority for charged amounts"):
//     the injected money is charged BECAUSE the order is built from the EP
//     cart, the authoritative total governs free-vs-paid (never a client
//     number), the cart-hash pins the line set against post-session tampering,
//     and the public shopper route can neither inject nor strip a money line.
//
//     These assertions exercise the checkout boundary that *consumes* an
//     injected adjustment; the bounds on the injection itself (amountMinor ≥ 0,
//     etc.) are unit-tested in ep-server-functions/__tests__/custom-cart-item.
// ===========================================================================

describe("applyCartAdjustment money integrity (#371)", () => {
  // A product line + a storefront-injected custom_item fee line. The cart's
  // authoritative total already reflects the fee (5000 + 500).
  const FEE_LINE = { id: "adj-fee-1", quantity: 1, unit_price: { amount: 500 } };
  const ITEMS_WITH_FEE = [...PRICED_ITEMS, FEE_LINE];

  it("charges the EP-cart total INCLUDING the adjustment: the order is built from the fee-bearing cart", async () => {
    const adapter = createMockAdapter();
    // The cart that /pay re-reads carries the fee line and a total that includes it.
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5900, ITEMS_WITH_FEE));
    // Session was created against the same line set (fee included) — hashes match.
    const ctx = createMockCtx(
      makeSession({ cartHash: hashCart(ITEMS_WITH_FEE) }),
      adapter
    );

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    expect(res.status).toBe(200);
    expect((res.body as any).data.session.status).toBe("complete");
    // Paid path (non-zero authoritative total), NOT free settlement.
    expect(adapter.initializePayment).toHaveBeenCalledTimes(1);
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    // The order is created from the EP cart that holds the fee line — so the
    // injected money is what gets charged.
    expect(epSdk.checkoutApi).toHaveBeenCalledTimes(1);
    expect(epSdk.checkoutApi.mock.calls[0][0].path.cartID).toBe("cart-abc");
  });

  it("ignores a client-forged amount in the pay body — the cart's authoritative total governs free-vs-paid", async () => {
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5900, ITEMS_WITH_FEE));
    const ctx = createMockCtx(
      makeSession({ cartHash: hashCart(ITEMS_WITH_FEE) }),
      adapter
    );

    // A shopper tries to zero out the charge via the request body.
    const res = await handlePay(
      createMockReq({
        gateway: "stripe",
        confirmation_token: "ctok",
        amount: 0,
        total: 0,
        amountMinor: 0,
      }),
      ctx
    );

    expect(res.status).toBe(200);
    // The forged zero did NOT route to free settlement; the cart total wins.
    expect(epSdk.paymentSetup).not.toHaveBeenCalled();
    expect(adapter.initializePayment).toHaveBeenCalledTimes(1);
  });

  it("rejects with 409 when a cart line is added/removed after session creation (can't forge or strip an adjustment behind the session's back)", async () => {
    const adapter = createMockAdapter();
    // Session was created against the cart the shopper reviewed (NO fee line)…
    const ctx = createMockCtx(
      makeSession({ cartHash: hashCart(PRICED_ITEMS) }),
      adapter
    );
    // …but the live cart's line set has since changed (a fee line appeared).
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5900, ITEMS_WITH_FEE));

    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    // Cart-hash mismatch: no charge, no order — the line set is pinned at
    // session creation, so an adjustment must be applied before/at session
    // create (or the session re-synced), never slipped in unnoticed.
    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("CART_MISMATCH");
    expect(adapter.initializePayment).not.toHaveBeenCalled();
    expect(epSdk.checkoutApi).not.toHaveBeenCalled();
  });

  it("the public update-session route cannot inject a money adjustment into the session", async () => {
    const ctx = createMockCtx(makeSession({ customAttributes: {} }), undefined, {
      allowedCustomAttributeKeys: ["industry"],
    });

    // A shopper posts forged money-bearing fields to the public route.
    const res = await handleUpdateSession(
      createMockReq({
        label: "Forged discount",
        amountMinor: -9999,
        kind: "fee",
        customItem: { type: "custom_item", price: { amount: -9999 } },
        items: [{ type: "custom_item" }],
        total: 0,
      }),
      ctx
    );

    expect(res.status).toBe(200);
    const stored = (res.body as any).data.session;
    // None of the forged money fields enter the session — update-session is a
    // fixed allow-list (selections, addresses, gated customAttributes) and
    // carries no authoritative amount.
    expect(stored.amountMinor).toBeUndefined();
    expect(stored.customItem).toBeUndefined();
    expect(stored.items).toBeUndefined();
    expect(stored.total).toBeUndefined();
    expect(stored.label).toBeUndefined();
    // No cart write happened on this public route.
    expect(epSdk.updateACart).not.toHaveBeenCalled();
    // And the persisted session is unchanged where it counts (same cart).
    const persisted = (ctx.sessionStore.set as jest.Mock).mock.calls[0][1];
    expect(persisted.cartId).toBe("cart-abc");
  });
});

// ===========================================================================
// 2. Token-leak boundary — admin / shopper tokens must never reflect into a
//    response. Covers every checkout-session route, including #368's new
//    branches (the order-custom-fields write, which carries the admin token in
//    an explicit Bearer header, and the free-order settlement path).
// ===========================================================================

/** The serialised response (status + body + headers) must contain neither the
 * admin client-credentials token nor the shopper token. The legitimate
 * Set-Cookie header carries the encrypted session, which never holds a token. */
function expectNoTokenLeak(res: { status: number; body: unknown; headers?: unknown }) {
  const serialised = JSON.stringify({
    status: res.status,
    body: res.body,
    headers: res.headers ?? null,
  });
  expect(serialised).not.toContain(ADMIN_TOKEN);
  expect(serialised).not.toContain(SHOPPER_TOKEN);
}

describe("token-leak boundary — no admin/shopper token in any response", () => {
  // customAttributes ensure the order-custom-fields write (admin Bearer token)
  // actually runs on the pay paths — exercising the #368 branches, not just
  // skipping them.
  const EXTRAS = { industry: "Tech", marketingOptIn: true } as const;

  it("paid pay() — admin token (checkoutApi/confirmOrder/order-fields) never reflected", async () => {
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(makeSession({ customAttributes: { ...EXTRAS } }), adapter, {
      allowedCustomAttributeKeys: "*",
    });
    const res = await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );
    expect(res.status).toBe(200);
    // The admin token DID travel to the outbound order-fields write...
    expect(epSdk.updateAnOrder).toHaveBeenCalledTimes(1);
    expect(epSdk.updateAnOrder.mock.calls[0][0].headers.Authorization).toBe(
      `Bearer ${ADMIN_TOKEN}`
    );
    // ...but it must NOT come back in the response.
    expectNoTokenLeak(res);
  });

  it("free pay() — settleFreeOrder + order-fields write never reflect the admin token", async () => {
    const FREE_ITEMS = [{ id: "free-1", quantity: 1 }];
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(0, FREE_ITEMS));
    const ctx = createMockCtx(
      makeSession({
        cartHash: hashCart(FREE_ITEMS),
        customAttributes: { ...EXTRAS },
        requiresShipping: false,
      }),
      undefined,
      { allowedCustomAttributeKeys: "*" }
    );
    const res = await handlePay(createMockReq({}), ctx);
    expect(res.status).toBe(200);
    expect(epSdk.paymentSetup).toHaveBeenCalledTimes(1);
    expect(epSdk.updateAnOrder.mock.calls[0][0].headers.Authorization).toBe(
      `Bearer ${ADMIN_TOKEN}`
    );
    expectNoTokenLeak(res);
  });

  it("confirm() never reflects a token", async () => {
    const adapter = createMockAdapter(undefined, { status: "succeeded" });
    const ctx = createMockCtx(
      makeSession({
        status: "processing",
        payment: {
          gateway: "stripe",
          status: "requires_action",
          clientToken: null,
          gatewayMetadata: {},
          actionData: null,
        },
        order: { id: "order-1", transactionId: "txn-1" },
      }),
      adapter
    );
    const res = await handleConfirm(createMockReq({}), ctx);
    expect(res.status).toBe(200);
    expectNoTokenLeak(res);
  });

  it("create-session() never reflects the cart-read token", async () => {
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(null);
    const res = await handleCreateSession(createMockReq({ cartId: "cart-abc" }), ctx);
    expect(res.status).toBe(201);
    expectNoTokenLeak(res);
  });

  it("update-session() never reflects a token", async () => {
    const ctx = createMockCtx(makeSession());
    const res = await handleUpdateSession(
      createMockReq({ customAttributes: { ...EXTRAS } }),
      ctx
    );
    expect(res.status).toBe(200);
    expectNoTokenLeak(res);
  });

  it("calculate-shipping() never reflects a token", async () => {
    const ctx = createMockCtx(makeSession());
    const res = await handleCalculateShipping(createMockReq({}), ctx);
    expect(res.status).toBe(200);
    expectNoTokenLeak(res);
  });

  it("get-session() never reflects a token", async () => {
    const ctx = createMockCtx(makeSession());
    const res = await handleGetSession(createMockReq({}), ctx);
    expect(res.status).toBe(200);
    expectNoTokenLeak(res);
  });
});

// ===========================================================================
// 3. No-PII logging — the logger must never emit a customer's contact details
//    or any customAttributes *value* (phone, VAT, consent text). The logger
//    only logs cartId/orderId/sessionId/error.message/field-keys today; this
//    guards against a regression that dumps the session or the extras map.
// ===========================================================================

describe("no-PII logging across the pipeline", () => {
  const PII_ATTRS = {
    phone: PII_PHONE,
    vatNumber: PII_VAT,
    marketingOptIn: true,
  } as const;
  const PII_CUSTOMER = { name: PII_NAME, email: PII_EMAIL };

  const consoleSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    // The logger is SILENT unless EP_DEBUG is set; force it fully on so a leak
    // would actually be emitted (a silent logger trivially "passes").
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => "*",
    };
    resetLogConfig();
    for (const method of ["debug", "info", "warn", "error"] as const) {
      consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
    }
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
    consoleSpies.length = 0;
    delete (globalThis as { localStorage?: unknown }).localStorage;
    resetLogConfig();
  });

  /** Every argument passed to any console method during the test, serialised. */
  function allLogOutput(): string {
    return consoleSpies
      .flatMap((spy) => spy.mock.calls as unknown[][])
      .map((args) =>
        args.map((a: unknown) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
      )
      .join("\n");
  }

  function expectNoPII(logged: string) {
    expect(logged).not.toContain(PII_PHONE);
    expect(logged).not.toContain(PII_VAT);
    expect(logged).not.toContain(PII_EMAIL);
    expect(logged).not.toContain(PII_NAME);
  }

  it("paid pay() with PII extras logs no field values (success info path)", async () => {
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(
      makeSession({ customAttributes: { ...PII_ATTRS }, customerInfo: PII_CUSTOMER }),
      adapter,
      { allowedCustomAttributeKeys: "*" }
    );
    await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    const logged = allLogOutput();
    expect(logged.length).toBeGreaterThan(0); // logging really is on
    expectNoPII(logged);
  });

  it("pay() warn paths (cart-attr + order-field write failures) log no PII", async () => {
    // Force the best-effort writes to fail so their warn branches fire.
    epSdk.updateACart.mockRejectedValue(new Error("EP cart write rejected"));
    epSdk.updateAnOrder.mockRejectedValue(new Error("EP order write rejected"));
    const adapter = createMockAdapter();
    epSdk.getACart.mockResolvedValue(cartResponseWithTotal(5400));
    const ctx = createMockCtx(
      makeSession({ customAttributes: { ...PII_ATTRS }, customerInfo: PII_CUSTOMER }),
      adapter,
      { allowedCustomAttributeKeys: "*" }
    );
    await handlePay(
      createMockReq({ gateway: "stripe", confirmation_token: "ctok" }),
      ctx
    );

    const logged = allLogOutput();
    expect(logged).toContain("custom attributes"); // a warn branch did fire
    expectNoPII(logged);
  });

  it("update-session() logs field keys, never customAttributes values", async () => {
    const ctx = createMockCtx(makeSession(), undefined, {
      allowedCustomAttributeKeys: "*",
    });
    await handleUpdateSession(
      createMockReq({ customAttributes: { ...PII_ATTRS }, customerInfo: PII_CUSTOMER }),
      ctx
    );

    const logged = allLogOutput();
    expect(logged).toContain("customAttributes"); // the top-level KEY is logged
    expectNoPII(logged); // ...but none of the VALUES are
  });
});
