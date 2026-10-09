const mockManageCarts = jest.fn();
const mockCreateACart = jest.fn();
const mockUpdateACartItem = jest.fn();
const mockDeleteACartItem = jest.fn();
const mockGetACart = jest.fn();
const mockDeleteAPromotion = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  manageCarts: (...args: unknown[]) => mockManageCarts(...args),
  createACart: (...args: unknown[]) => mockCreateACart(...args),
  updateACartItem: (...args: unknown[]) => mockUpdateACartItem(...args),
  deleteACartItem: (...args: unknown[]) => mockDeleteACartItem(...args),
  getACart: (...args: unknown[]) => mockGetACart(...args),
  deleteAPromotionViaPromotionCode: (...args: unknown[]) =>
    mockDeleteAPromotion(...args),
}));

// Proxy fallback is the browser path. Default `shouldUseProxy` to false so the
// server-side tests below exercise the direct (ALS-session) path; the one
// browser-path test flips it on.
const mockShouldUseProxy = jest.fn(() => false);
const mockCallEpProxy = jest.fn();
jest.mock("../proxy-fetch", () => ({
  shouldUseProxy: () => mockShouldUseProxy(),
  callEpProxy: (...args: unknown[]) => mockCallEpProxy(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  epAddCartItem,
  epApplyCartAdjustment,
  epApplyPromoCode,
  epRemovePromoCode,
  epUpdateCartItem,
  epRemoveCartItem,
} = require("../cart-mutations");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { makeEpCallError } = require("../call-error");

type CartWriteError = Error & {
  code?: string;
  correlationId?: string;
  cause?: unknown;
};

function rejectionOf(write: Promise<unknown>): Promise<CartWriteError> {
  return write.then(
    () => {
      throw new Error("expected the cart write to reject");
    },
    (err) => err as CartWriteError
  );
}

function causeOf(err: CartWriteError): string {
  return err.cause instanceof Error ? err.cause.message : String(err.cause);
}

const ADD_FAILED = "We couldn't add this item to your cart. Please try again.";
const UPDATE_FAILED = "We couldn't update the quantity. Please try again.";
const REMOVE_FAILED = "We couldn't remove this item. Please try again.";
const OUT_OF_STOCK =
  "There isn't enough stock to add that quantity. Try a smaller amount.";
const SESSION_EXPIRED = "Your session expired. Refresh the page and try again.";

const SESSION_BASE = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const CART_RESPONSE = {
  data: {
    data: {
      id: "cart-id",
      type: "cart",
      attributes: { name: "Cart" },
      meta: {
        display_price: {
          with_tax: { amount: 5000, currency: "USD", formatted: "$50.00" },
          without_tax: { amount: 5000, currency: "USD", formatted: "$50.00" },
        },
      },
    },
    included: { items: [] },
  },
};

const CART_WITH_ITEM_RESPONSE = {
  data: {
    data: {
      id: "cart-id",
      type: "cart",
      attributes: { name: "Cart" },
      meta: {
        display_price: {
          with_tax: { amount: 5000, currency: "USD", formatted: "$50.00" },
          without_tax: { amount: 5000, currency: "USD", formatted: "$50.00" },
        },
      },
    },
    included: {
      items: [
        {
          id: "li-1",
          type: "cart_item",
          product_id: "prod-1",
          name: "Test",
          quantity: 1,
          unit_price: { amount: 1000, currency: "USD" },
        },
      ],
    },
  },
};

function mockSuccessfulAdd(cartId = "cart-id") {
  mockManageCarts.mockResolvedValue({
    data: {
      data: { id: cartId },
      included: { items: [{ id: "li-1" }] },
    },
  });
  const base =
    cartId === "cart-id"
      ? CART_WITH_ITEM_RESPONSE
      : {
          ...CART_WITH_ITEM_RESPONSE,
          data: {
            ...CART_WITH_ITEM_RESPONSE.data,
            data: { ...CART_WITH_ITEM_RESPONSE.data.data, id: cartId },
          },
        };
  mockGetACart.mockResolvedValue(base);
}

beforeEach(() => {
  mockManageCarts.mockReset();
  mockCreateACart.mockReset();
  mockUpdateACartItem.mockReset();
  mockDeleteACartItem.mockReset();
  mockGetACart.mockReset();
  mockDeleteAPromotion.mockReset();
  mockShouldUseProxy.mockReset();
  mockShouldUseProxy.mockReturnValue(false);
  mockCallEpProxy.mockReset();
});

describe("epAddCartItem", () => {
  it("adds an item to the cart carried by the ALS session and returns the normalized cart", async () => {
    mockSuccessfulAdd();

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id" },
      () => epAddCartItem({ productId: "prod-1", quantity: 2 })
    );

    expect(result).not.toBeNull();
    expect(result.id).toBe("cart-id");
    expect(result.items).toHaveLength(1);
    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id" },
        body: {
          data: expect.objectContaining({
            type: "cart_item",
            id: "prod-1",
            quantity: 2,
          }),
        },
      })
    );
    expect(mockCreateACart).not.toHaveBeenCalled();
  });

  it("rejects as no_session when called without an active EP session", async () => {
    const err = await rejectionOf(
      epAddCartItem({ productId: "prod-1", quantity: 1 })
    );

    expect(err.message).toBe(SESSION_EXPIRED);
    expect(err.code).toBe("no_session");
    expect(causeOf(err)).toMatch(/no EP session/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("auto-creates a cart on the first add when no cartId is on the session, then adds the item to it", async () => {
    mockCreateACart.mockResolvedValue({
      data: { data: { id: "new-cart-id", type: "cart" } },
    });
    mockSuccessfulAdd("new-cart-id");

    const result = await withEpSession(SESSION_BASE, () =>
      epAddCartItem({ productId: "prod-1", quantity: 1 })
    );

    expect(mockCreateACart).toHaveBeenCalledTimes(1);
    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "new-cart-id" },
      })
    );
    expect(result.id).toBe("new-cart-id");
  });

  it("keeps the underlying SDK error as the cause when the EP backend rejects the add", async () => {
    const sdkError = Object.assign(new Error("EP 503"), { status: 503 });
    mockManageCarts.mockRejectedValue(sdkError);

    const err = await rejectionOf(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epAddCartItem({ productId: "prod-1", quantity: 1 })
      )
    );

    expect(err.message).toBe(ADD_FAILED);
    expect(err.code).toBe("dispatch_failed");
    expect(err.cause).toBe(sdkError);
  });

  it("throws when manageCarts soft-fails with { error } (throwOnError defaults false)", async () => {
    mockManageCarts.mockResolvedValue({
      error: {
        errors: [{ detail: "The product is not available for purchase" }],
      },
    });

    const err = await rejectionOf(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epAddCartItem({ productId: "prod-1", quantity: 1 })
      )
    );

    expect(err.message).toBe(ADD_FAILED);
    expect(err.code).toBe("dispatch_failed");
    expect(causeOf(err)).toMatch(/not available for purchase/);
    expect(mockGetACart).not.toHaveBeenCalled();
  });

  it("throws when manageCarts succeeds but the re-fetched cart has no line items", async () => {
    mockManageCarts.mockResolvedValue({
      data: { data: { id: "cart-id" }, included: { items: [] } },
      response: { status: 201 },
    });
    mockGetACart.mockResolvedValue(CART_RESPONSE); // included.items: []

    const err = await rejectionOf(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epAddCartItem({ productId: "prod-1", quantity: 1 })
      )
    );

    expect(err.message).toBe(ADD_FAILED);
    expect(causeOf(err)).toMatch(/cart still empty after add/);
  });

  it("uses sku rather than productId when the input provides a sku (variant selection)", async () => {
    mockSuccessfulAdd();

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epAddCartItem({ productId: "prod-1", quantity: 1, sku: "SKU-RED-LG" })
    );

    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          data: expect.objectContaining({
            type: "cart_item",
            sku: "SKU-RED-LG",
            quantity: 1,
          }),
        },
      })
    );
    // Per EP API: when sku is supplied, id MUST NOT be sent.
    const body = mockManageCarts.mock.calls[0][0].body.data;
    expect(body.id).toBeUndefined();
  });

  it("forwards customInputs (variant labels, gift messages) onto the cart item", async () => {
    mockSuccessfulAdd();

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epAddCartItem({
        productId: "prod-1",
        quantity: 1,
        customInputs: { _selectedOptions: [{ name: "Color", value: "Red" }] },
      })
    );

    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          data: expect.objectContaining({
            custom_inputs: {
              _selectedOptions: [{ name: "Color", value: "Red" }],
            },
          }),
        },
      })
    );
  });

  it("forwards bundleConfiguration and location for EP-specific cart-item shapes", async () => {
    mockSuccessfulAdd();

    const bundle = { selected: { components: { kit: { sku: "X" } } } };

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epAddCartItem({
        productId: "prod-1",
        quantity: 1,
        bundleConfiguration: bundle,
        location: "store-42",
      })
    );

    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          data: expect.objectContaining({
            bundle_configuration: bundle,
            location: "store-42",
          }),
        },
      })
    );
  });
});

describe("epApplyCartAdjustment", () => {
  it("writes a custom_item adjustment to the session cart and returns the normalized cart", async () => {
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id", locale: "en-US", currency: "USD" },
      () =>
        epApplyCartAdjustment({
          label: "Handling fee",
          amountMinor: 500,
          kind: "handling",
        })
    );

    expect(result.id).toBe("cart-id");
    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id" },
        body: {
          data: expect.objectContaining({
            type: "custom_item",
            name: "Handling fee",
            quantity: 1,
            price: { amount: 500, includes_tax: true },
            custom_inputs: { kind: "handling" },
          }),
        },
      })
    );
  });

  it("throws when called without an active EP session", async () => {
    await expect(
      epApplyCartAdjustment({ label: "Fee", amountMinor: 500, kind: "fee" })
    ).rejects.toThrow(/no EP session/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("throws when the session has no cartId (nothing to adjust)", async () => {
    await expect(
      withEpSession(SESSION_BASE, () =>
        epApplyCartAdjustment({ label: "Fee", amountMinor: 500, kind: "fee" })
      )
    ).rejects.toThrow(/no cart/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("propagates the primitive's bound rejection (negative amount) without writing", async () => {
    await expect(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epApplyCartAdjustment({ label: "Discount", amountMinor: -100, kind: "fee" })
      )
    ).rejects.toThrow(/non-negative integer/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("routes to the consumer proxy (no direct write) when invoked in the browser with no ALS session", async () => {
    // Browser path: no withEpSession scope, but shouldUseProxy() is true.
    mockShouldUseProxy.mockReturnValue(true);
    const proxiedCart = { id: "cart-id", lineItems: [], totalPrice: 5 };
    mockCallEpProxy.mockResolvedValue(proxiedCart);

    const result = await epApplyCartAdjustment({
      label: "Handling fee",
      amountMinor: 500,
      kind: "handling",
      quantity: 2,
    });

    // It delegated to the proxy with the flat input, and did NOT touch the SDK
    // directly (the credentialed write happens server-side inside the proxy).
    expect(mockCallEpProxy).toHaveBeenCalledWith("applyCartAdjustment", {
      label: "Handling fee",
      amountMinor: 500,
      kind: "handling",
      quantity: 2,
    });
    expect(mockManageCarts).not.toHaveBeenCalled();
    expect(result).toBe(proxiedCart);
  });

  it("omits quantity from the proxy payload when not supplied", async () => {
    mockShouldUseProxy.mockReturnValue(true);
    mockCallEpProxy.mockResolvedValue({ id: "cart-id" });

    await epApplyCartAdjustment({ label: "Fee", amountMinor: 500, kind: "fee" });

    expect(mockCallEpProxy).toHaveBeenCalledWith("applyCartAdjustment", {
      label: "Fee",
      amountMinor: 500,
      kind: "fee",
    });
  });

  it("does NOT use the proxy on the server (ALS session present) — writes directly", async () => {
    mockShouldUseProxy.mockReturnValue(true); // even if true, a real session wins
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epApplyCartAdjustment({ label: "Fee", amountMinor: 500, kind: "fee" })
    );

    expect(mockCallEpProxy).not.toHaveBeenCalled();
    expect(mockManageCarts).toHaveBeenCalled();
  });
});

describe("epUpdateCartItem", () => {
  it("updates an item's quantity on the session cart and returns the normalized cart", async () => {
    mockUpdateACartItem.mockResolvedValue({});
    // First getACart resolves location from the existing line; second is the
    // post-update normalized fetch.
    mockGetACart
      .mockResolvedValueOnce({
        data: {
          data: { id: "cart-id" },
          included: {
            items: [{ id: "item-1", type: "cart_item", quantity: 1 }],
          },
        },
      })
      .mockResolvedValueOnce(CART_RESPONSE);

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id" },
      () => epUpdateCartItem({ itemId: "item-1", quantity: 3 })
    );

    expect(result.id).toBe("cart-id");
    expect(mockUpdateACartItem).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id", cartitemID: "item-1" },
        body: {
          data: expect.objectContaining({
            type: "cart_item",
            quantity: 3,
          }),
        },
      })
    );
  });

  it("includes location on update when provided (multi-location stock)", async () => {
    mockUpdateACartItem.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epUpdateCartItem({
        itemId: "item-1",
        quantity: 2,
        location: "warehouse-east",
      })
    );

    expect(mockUpdateACartItem).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          data: expect.objectContaining({
            location: "warehouse-east",
            quantity: 2,
          }),
        },
      })
    );
    // Caller supplied location — no pre-read of the cart for location.
    expect(mockGetACart).toHaveBeenCalledTimes(1);
  });

  it("resolves location from the existing cart line when the caller omits it", async () => {
    mockUpdateACartItem.mockResolvedValue({});
    mockGetACart
      .mockResolvedValueOnce({
        data: {
          data: { id: "cart-id" },
          included: {
            items: [
              {
                id: "item-1",
                type: "cart_item",
                quantity: 2,
                location: "store-downtown",
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce(CART_RESPONSE);

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epUpdateCartItem({ itemId: "item-1", quantity: 1 })
    );

    expect(mockUpdateACartItem).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          data: expect.objectContaining({
            location: "store-downtown",
            quantity: 1,
          }),
        },
      })
    );
  });

  it("rejects as no_session when called without an active EP session", async () => {
    const err = await rejectionOf(
      epUpdateCartItem({ itemId: "item-1", quantity: 1 })
    );

    expect(err.message).toBe(SESSION_EXPIRED);
    expect(err.code).toBe("no_session");
    expect(causeOf(err)).toMatch(/no EP session/i);
  });

  it("rejects as no_session when the session has no cartId (nothing to update against)", async () => {
    const err = await rejectionOf(
      withEpSession(SESSION_BASE, () =>
        epUpdateCartItem({ itemId: "item-1", quantity: 1 })
      )
    );

    expect(err.code).toBe("no_session");
    expect(causeOf(err)).toMatch(/no cart/i);
    expect(mockUpdateACartItem).not.toHaveBeenCalled();
  });
  it("throws when updateACartItem soft-fails with { error }", async () => {
    mockGetACart.mockResolvedValue({
      data: {
        data: { id: "cart-id" },
        included: { items: [{ id: "item-1", type: "cart_item", quantity: 1 }] },
      },
    });
    mockUpdateACartItem.mockResolvedValue({
      error: { errors: [{ detail: "quantity exceeds stock" }] },
    });

    const err = await rejectionOf(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epUpdateCartItem({ itemId: "item-1", quantity: 99 })
      )
    );

    expect(err.message).toBe(UPDATE_FAILED);
    expect(err.code).toBe("dispatch_failed");
    expect(causeOf(err)).toMatch(/quantity exceeds stock/);
    // Location pre-read happens; post-update cart fetch must not.
    expect(mockGetACart).toHaveBeenCalledTimes(1);
  });
});

describe("epRemoveCartItem", () => {
  it("removes an item from the session cart and returns the normalized cart", async () => {
    mockDeleteACartItem.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id" },
      () => epRemoveCartItem({ itemId: "item-1" })
    );

    expect(result.id).toBe("cart-id");
    expect(mockDeleteACartItem).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id", cartitemID: "item-1" },
      })
    );
  });

  it("rejects as no_session when called without an active EP session", async () => {
    const err = await rejectionOf(epRemoveCartItem({ itemId: "item-1" }));

    expect(err.message).toBe(SESSION_EXPIRED);
    expect(err.code).toBe("no_session");
  });

  it("rejects as no_session when the session has no cartId (nothing to remove from)", async () => {
    const err = await rejectionOf(
      withEpSession(SESSION_BASE, () => epRemoveCartItem({ itemId: "item-1" }))
    );

    expect(err.code).toBe("no_session");
    expect(causeOf(err)).toMatch(/no cart/i);
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
  });

  it("throws when deleteACartItem soft-fails with { error }", async () => {
    mockDeleteACartItem.mockResolvedValue({
      error: { errors: [{ detail: "cart item not found" }] },
    });

    const err = await rejectionOf(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epRemoveCartItem({ itemId: "item-1" })
      )
    );

    expect(err.message).toBe(REMOVE_FAILED);
    expect(err.code).toBe("dispatch_failed");
    expect(causeOf(err)).toMatch(/cart item not found/);
    expect(mockGetACart).not.toHaveBeenCalled();
  });
});

const CART_WITH_PROMOTION_RESPONSE = {
  data: {
    data: {
      id: "cart-id",
      type: "cart",
      attributes: { name: "Cart" },
      meta: {
        display_price: {
          with_tax: { amount: 4500, currency: "USD", formatted: "$45.00" },
          without_tax: { amount: 4500, currency: "USD", formatted: "$45.00" },
          discount: { amount: -500, currency: "USD", formatted: "-$5.00" },
        },
      },
    },
    included: {
      items: [
        {
          id: "promo-1",
          type: "promotion_item",
          promotion_id: "a590f816",
          name: "Five off",
          sku: "SAVE5",
          meta: {
            display_price: {
              without_tax: {
                unit: { amount: -500, currency: "USD", formatted: "-$5.00" },
                value: { amount: -500, currency: "USD", formatted: "-$5.00" },
              },
            },
          },
        },
      ],
    },
  },
};

describe("epApplyPromoCode", () => {
  it("sends the code and nothing else, then returns the re-priced cart", async () => {
    mockManageCarts.mockResolvedValue({ data: {} });
    mockGetACart.mockResolvedValue(CART_WITH_PROMOTION_RESPONSE);

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id" },
      () => epApplyPromoCode({ code: "SAVE5" })
    );

    // The merchant's money never travels from the caller: the body carries a
    // code, and the amount comes back from Elastic Path.
    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id" },
        body: { data: { type: "promotion_item", code: "SAVE5" } },
      })
    );
    expect(result.promotions).toHaveLength(1);
    expect(
      result.promotions[0].meta.display_price.without_tax.value.formatted
    ).toBe("-$5.00");
  });

  it("trims the code the shopper typed", async () => {
    mockManageCarts.mockResolvedValue({ data: {} });
    mockGetACart.mockResolvedValue(CART_WITH_PROMOTION_RESPONSE);

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epApplyPromoCode({ code: "  SAVE5 " })
    );

    expect(mockManageCarts).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { data: { type: "promotion_item", code: "SAVE5" } },
      })
    );
  });

  it("throws EP's reason when the code is rejected", async () => {
    mockManageCarts.mockResolvedValue({
      error: { errors: [{ detail: "promotion code is not valid" }] },
    });

    await expect(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epApplyPromoCode({ code: "EXPIRED" })
      )
    ).rejects.toThrow(/promotion code is not valid/);
    expect(mockGetACart).not.toHaveBeenCalled();
  });

  it("throws when EP accepts the code but writes no promotion line", async () => {
    // A 201 with an unchanged cart is how a code the basket does not qualify
    // for comes back; reporting success would leave the shopper staring at the
    // same total with nothing said.
    mockManageCarts.mockResolvedValue({ data: {} });
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    await expect(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epApplyPromoCode({ code: "NOPE" })
      )
    ).rejects.toThrow(/did not apply/i);
  });

  it("throws on an empty code without calling EP", async () => {
    await expect(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epApplyPromoCode({ code: "   " })
      )
    ).rejects.toThrow(/no code/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("throws when called without an active EP session", async () => {
    await expect(epApplyPromoCode({ code: "SAVE5" })).rejects.toThrow(
      /no EP session/i
    );
  });

  it("throws when the session has no cartId", async () => {
    await expect(
      withEpSession(SESSION_BASE, () => epApplyPromoCode({ code: "SAVE5" }))
    ).rejects.toThrow(/no cart/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });
});

describe("epRemovePromoCode", () => {
  it("removes by code and returns the re-priced cart", async () => {
    mockDeleteAPromotion.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id" },
      () => epRemovePromoCode({ code: "SAVE5" })
    );

    expect(mockDeleteAPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-id", promoCode: "SAVE5" },
      })
    );
    expect(result.promotions).toEqual([]);
  });

  it("throws when EP rejects the removal", async () => {
    mockDeleteAPromotion.mockResolvedValue({
      error: { errors: [{ detail: "promotion not found" }] },
    });

    await expect(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epRemovePromoCode({ code: "SAVE5" })
      )
    ).rejects.toThrow(/promotion not found/);
    expect(mockGetACart).not.toHaveBeenCalled();
  });

  it("throws when called without an active EP session", async () => {
    await expect(epRemovePromoCode({ code: "SAVE5" })).rejects.toThrow(
      /no EP session/i
    );
  });
});

describe("browser transport", () => {
  beforeEach(() => {
    mockShouldUseProxy.mockReturnValue(true);
  });

  it("adds through the proxy, carrying every field the write needs", async () => {
    const proxiedCart = { id: "cart-id", items: [] };
    mockCallEpProxy.mockResolvedValue(proxiedCart);

    const result = await epAddCartItem({
      productId: "p1",
      quantity: 2,
      sku: "SKU-1",
      customInputs: { gift: "yes" },
      bundleConfiguration: { selected_options: {} },
      location: "warehouse-a",
    });

    expect(mockCallEpProxy).toHaveBeenCalledWith("addCartItem", {
      productId: "p1",
      quantity: 2,
      sku: "SKU-1",
      customInputs: { gift: "yes" },
      bundleConfiguration: { selected_options: {} },
      location: "warehouse-a",
    });
    expect(mockManageCarts).not.toHaveBeenCalled();
    expect(mockCreateACart).not.toHaveBeenCalled();
    expect(result).toBe(proxiedCart);
  });

  it("updates through the proxy", async () => {
    const proxiedCart = { id: "cart-id", items: [] };
    mockCallEpProxy.mockResolvedValue(proxiedCart);

    const result = await epUpdateCartItem({
      itemId: "item-1",
      quantity: 3,
      location: "warehouse-a",
    });

    expect(mockCallEpProxy).toHaveBeenCalledWith("updateCartItem", {
      itemId: "item-1",
      quantity: 3,
      location: "warehouse-a",
    });
    expect(mockUpdateACartItem).not.toHaveBeenCalled();
    expect(result).toBe(proxiedCart);
  });

  it("removes through the proxy", async () => {
    const proxiedCart = { id: "cart-id", items: [] };
    mockCallEpProxy.mockResolvedValue(proxiedCart);

    const result = await epRemoveCartItem({ itemId: "item-1" });

    expect(mockCallEpProxy).toHaveBeenCalledWith("removeCartItem", {
      itemId: "item-1",
    });
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
    expect(result).toBe(proxiedCart);
  });

  it("applies a promo code through the proxy, sending only the code", async () => {
    const proxiedCart = { id: "cart-id", items: [], promotions: [] };
    mockCallEpProxy.mockResolvedValue(proxiedCart);

    const result = await epApplyPromoCode({ code: " SAVE5 " });

    expect(mockCallEpProxy).toHaveBeenCalledWith("applyPromoCode", {
      code: "SAVE5",
    });
    expect(mockManageCarts).not.toHaveBeenCalled();
    expect(result).toBe(proxiedCart);
  });

  it("removes a promo code through the proxy", async () => {
    const proxiedCart = { id: "cart-id", items: [], promotions: [] };
    mockCallEpProxy.mockResolvedValue(proxiedCart);

    const result = await epRemovePromoCode({ code: "SAVE5" });

    expect(mockCallEpProxy).toHaveBeenCalledWith("removePromoCode", {
      code: "SAVE5",
    });
    expect(mockDeleteAPromotion).not.toHaveBeenCalled();
    expect(result).toBe(proxiedCart);
  });

  it("surfaces a proxy failure rather than reporting a write that never happened", async () => {
    const proxyError = new Error("ep proxy addCartItem failed (502)");
    mockCallEpProxy.mockRejectedValue(proxyError);

    const err = await rejectionOf(epAddCartItem({ productId: "p1", quantity: 1 }));

    expect(err.message).toBe(ADD_FAILED);
    expect(err.cause).toBe(proxyError);
  });

  it("writes directly when an ALS session is present", async () => {
    mockSuccessfulAdd();

    await withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
      epAddCartItem({ productId: "p1", quantity: 1 })
    );

    expect(mockCallEpProxy).not.toHaveBeenCalled();
    expect(mockManageCarts).toHaveBeenCalled();
  });
});

describe("a cart write the server rejects", () => {
  const SHOPPER = { ...SESSION_BASE, cartId: "cart-id" };
  const EP_STOCK_REASON = "There is not enough stock to add 99 of this item";

  it("names an out-of-stock add insufficient_stock, in shopper copy, with Elastic Path's reason as the cause", async () => {
    mockManageCarts.mockResolvedValue({
      error: { errors: [{ detail: EP_STOCK_REASON }] },
    });

    const err = await rejectionOf(
      withEpSession(SHOPPER, () =>
        epAddCartItem({ productId: "prod-1", quantity: 99 })
      )
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(OUT_OF_STOCK);
    expect(err.code).toBe("insufficient_stock");
    expect(causeOf(err)).toContain(EP_STOCK_REASON);
  });

  it("names an out-of-stock quantity change insufficient_stock", async () => {
    mockUpdateACartItem.mockResolvedValue({
      error: { errors: [{ detail: EP_STOCK_REASON }] },
    });

    const err = await rejectionOf(
      withEpSession(SHOPPER, () =>
        epUpdateCartItem({ itemId: "li-1", quantity: 99, location: "north" })
      )
    );

    expect(err.message).toBe(OUT_OF_STOCK);
    expect(err.code).toBe("insufficient_stock");
  });

  it("rejects the way the browser does for the same code", async () => {
    mockManageCarts.mockResolvedValue({
      error: { errors: [{ detail: EP_STOCK_REASON }] },
    });
    const onServer = await rejectionOf(
      withEpSession(SHOPPER, () =>
        epAddCartItem({ productId: "prod-1", quantity: 99 })
      )
    );

    mockShouldUseProxy.mockReturnValue(true);
    mockCallEpProxy.mockRejectedValue(
      makeEpCallError({
        message: "ep proxy addCartItem failed (500)",
        code: "insufficient_stock",
        correlationId: "corr-1",
      })
    );
    const inBrowser = await rejectionOf(
      epAddCartItem({ productId: "prod-1", quantity: 99 })
    );

    expect(inBrowser.message).toBe(onServer.message);
    expect(inBrowser.code).toBe(onServer.code);
    expect(inBrowser.correlationId).toBe("corr-1");
  });
});

describe("the cart a write resolves with", () => {
  const SHOPPER = {
    ...SESSION_BASE,
    cartId: "cart-id",
    locale: "fr-FR",
    currency: "EUR",
  };
  const PRICED_FOR_SHOPPER = {
    headers: { "Accept-Language": "fr-FR", "X-Moltin-Currency": "EUR" },
  };

  function lastCartRead() {
    return mockGetACart.mock.calls[mockGetACart.mock.calls.length - 1][0];
  }

  it("is priced for the shopper's locale and currency after an add", async () => {
    mockSuccessfulAdd();

    await withEpSession(SHOPPER, () =>
      epAddCartItem({ productId: "prod-1", quantity: 1 })
    );

    expect(lastCartRead()).toMatchObject(PRICED_FOR_SHOPPER);
  });

  it("is priced for the shopper's locale and currency after an update", async () => {
    mockUpdateACartItem.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_WITH_ITEM_RESPONSE);

    await withEpSession(SHOPPER, () =>
      epUpdateCartItem({ itemId: "li-1", quantity: 2, location: "north" })
    );

    expect(lastCartRead()).toMatchObject(PRICED_FOR_SHOPPER);
  });

  it("is priced for the shopper's locale and currency after a remove", async () => {
    mockDeleteACartItem.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    await withEpSession(SHOPPER, () => epRemoveCartItem({ itemId: "li-1" }));

    expect(lastCartRead()).toMatchObject(PRICED_FOR_SHOPPER);
  });
});
