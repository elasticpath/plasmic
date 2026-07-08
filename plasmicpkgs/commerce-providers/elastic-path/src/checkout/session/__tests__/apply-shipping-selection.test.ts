/**
 * applyShippingSelection — the checkout-session shipping write step.
 *
 * The authoritative-mutation composition (ADR-0013): the client selects a
 * `rateId`; the SERVER owns the amount (from `availableShippingRates`); the
 * write is credentialed (admin client). These tests assert the composition and
 * its fail-closed error surface, mocking the deep primitives.
 */
const mockGetACart = jest.fn();
const mockManageCarts = jest.fn();
const mockDeleteACartItem = jest.fn();
const mockCreateShopperClient = jest.fn(() => ({ client: { __admin: true } }));

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: (...args: unknown[]) => mockGetACart(...args),
  manageCarts: (...args: unknown[]) => mockManageCarts(...args),
  deleteACartItem: (...args: unknown[]) => mockDeleteACartItem(...args),
  createShopperClient: (...args: unknown[]) => mockCreateShopperClient(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyShippingSelection, ShippingResolutionError } = require("../apply-shipping-selection") as {
  applyShippingSelection: typeof import("../apply-shipping-selection").applyShippingSelection;
  ShippingResolutionError: typeof import("../apply-shipping-selection").ShippingResolutionError;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EP_SHIPPING_LINE_SKU } = require("../set-shipping-line") as {
  EP_SHIPPING_LINE_SKU: string;
};

import type {
  CheckoutSession,
  SessionHandlerContext,
  SessionShippingRate,
} from "../types";

const RATES: SessionShippingRate[] = [
  { id: "rate-standard", name: "Standard", amount: 500, currency: "CHF", serviceLevel: "standard", carrier: "DHL" },
  { id: "rate-express", name: "Express", amount: 1500, currency: "CHF", serviceLevel: "express", carrier: "DHL" },
];

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-1",
    status: "open",
    cartId: "cart-abc",
    cartHash: "h",
    customerInfo: null,
    shippingAddress: null,
    billingAddress: null,
    selectedShippingRateId: "rate-express",
    availableShippingRates: RATES,
    totals: null,
    payment: { gateway: null, status: "idle", clientToken: null, gatewayMetadata: {}, actionData: null },
    order: null,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

const ADMIN_TOKEN = "ADMIN-CC-TOKEN";

function makeCtx(overrides: Partial<SessionHandlerContext> = {}): SessionHandlerContext {
  return {
    epCredentials: { clientId: "test-id", apiBaseUrl: "https://api.test.com" },
    adapterRegistry: { register: jest.fn(), getAdapter: jest.fn() },
    sessionStore: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    getClientCredentialsToken: jest.fn(async () => ADMIN_TOKEN),
    ...overrides,
  };
}

function cart(items: Array<Record<string, unknown>> = []) {
  return {
    data: {
      data: {
        id: "cart-abc",
        type: "cart",
        meta: { display_price: { with_tax: { amount: 8000, currency: "CHF" } } },
      },
      included: { items },
    },
  };
}

beforeEach(() => {
  mockGetACart.mockReset().mockResolvedValue(cart([]));
  mockManageCarts.mockReset().mockResolvedValue({});
  mockDeleteACartItem.mockReset().mockResolvedValue({});
  mockCreateShopperClient.mockClear();
});

describe("applyShippingSelection — credentialed write of the resolved rate", () => {
  it("writes the SERVER amount for the selected id (never a client value)", async () => {
    const ctx = makeCtx();
    await applyShippingSelection(ctx, makeSession({ selectedShippingRateId: "rate-express" }));

    const body = mockManageCarts.mock.calls[0][0].body.data;
    expect(body.sku).toBe(EP_SHIPPING_LINE_SKU);
    expect(body.price.amount).toBe(1500); // resolved from RATES, not the id
    expect(body.custom_inputs.rateId).toBe("rate-express");
  });

  it("builds the admin client from the client_credentials token when none is injected", async () => {
    const ctx = makeCtx();
    await applyShippingSelection(ctx, makeSession());

    expect(ctx.getClientCredentialsToken).toHaveBeenCalledTimes(1);
    // The admin token is what the SDK client reads.
    const storage = mockCreateShopperClient.mock.calls[0][1].storage;
    expect(storage.get()).toBe(ADMIN_TOKEN);
  });

  it("uses an injected client and does NOT mint a fresh admin token (handlePay reuse)", async () => {
    const ctx = makeCtx();
    const injected = { __preBuilt: true } as never;
    await applyShippingSelection(ctx, makeSession(), { client: injected });

    expect(ctx.getClientCredentialsToken).not.toHaveBeenCalled();
    expect(mockCreateShopperClient).not.toHaveBeenCalled();
    expect(mockManageCarts.mock.calls[0][0].client).toBe(injected);
  });

  it("passes the resolved rate's own currency to the cart re-read", async () => {
    const ctx = makeCtx();
    await applyShippingSelection(ctx, makeSession({ selectedShippingRateId: "rate-standard" }));
    // call[1] is the re-read (call[0] is the idempotency read).
    expect(mockGetACart.mock.calls[1][0].headers["X-Moltin-Currency"]).toBe("CHF");
  });
});

describe("applyShippingSelection — fail-closed selection errors", () => {
  it("throws ShippingResolutionError (no write) for an un-offered/forged id", async () => {
    const ctx = makeCtx();
    await expect(
      applyShippingSelection(ctx, makeSession({ selectedShippingRateId: "rate-hacked" }))
    ).rejects.toBeInstanceOf(ShippingResolutionError);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("throws ShippingResolutionError (no write) when no rates were computed", async () => {
    const ctx = makeCtx();
    await expect(
      applyShippingSelection(ctx, makeSession({ availableShippingRates: [] }))
    ).rejects.toBeInstanceOf(ShippingResolutionError);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("throws ShippingResolutionError (no write) when no rate is selected", async () => {
    const ctx = makeCtx();
    await expect(
      applyShippingSelection(ctx, makeSession({ selectedShippingRateId: null }))
    ).rejects.toBeInstanceOf(ShippingResolutionError);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("propagates a backend write error as-is (NOT a ShippingResolutionError)", async () => {
    const ctx = makeCtx();
    mockManageCarts.mockRejectedValue(Object.assign(new Error("cart locked"), { status: 409 }));
    const err = await applyShippingSelection(ctx, makeSession()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ShippingResolutionError);
    expect(err.message).toMatch(/cart locked/);
  });
});
