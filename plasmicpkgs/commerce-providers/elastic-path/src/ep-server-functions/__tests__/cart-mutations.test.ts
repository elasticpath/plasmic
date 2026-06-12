const mockManageCarts = jest.fn();
const mockCreateACart = jest.fn();
const mockUpdateACartItem = jest.fn();
const mockDeleteACartItem = jest.fn();
const mockGetACart = jest.fn();

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
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  epAddCartItem,
  epApplyCartAdjustment,
  epUpdateCartItem,
  epRemoveCartItem,
} = require("../cart-mutations");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION_BASE = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
  serverCartMode: false,
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

beforeEach(() => {
  mockManageCarts.mockReset();
  mockCreateACart.mockReset();
  mockUpdateACartItem.mockReset();
  mockDeleteACartItem.mockReset();
  mockGetACart.mockReset();
});

describe("epAddCartItem", () => {
  it("adds an item to the cart carried by the ALS session and returns the normalized cart", async () => {
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

    const result = await withEpSession(
      { ...SESSION_BASE, cartId: "cart-id" },
      () => epAddCartItem({ productId: "prod-1", quantity: 2 })
    );

    expect(result).not.toBeNull();
    expect(result.id).toBe("cart-id");
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

  it("throws when called without an active EP session", async () => {
    await expect(
      epAddCartItem({ productId: "prod-1", quantity: 1 })
    ).rejects.toThrow(/no EP session/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("auto-creates a cart on the first add when no cartId is on the session, then adds the item to it", async () => {
    mockCreateACart.mockResolvedValue({
      data: { data: { id: "new-cart-id", type: "cart" } },
    });
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue({
      ...CART_RESPONSE,
      data: {
        ...CART_RESPONSE.data,
        data: { ...CART_RESPONSE.data.data, id: "new-cart-id" },
      },
    });

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

  it("propagates the underlying SDK error when the EP backend rejects the add", async () => {
    mockManageCarts.mockRejectedValue(
      Object.assign(new Error("out of stock"), { status: 422 })
    );

    await expect(
      withEpSession({ ...SESSION_BASE, cartId: "cart-id" }, () =>
        epAddCartItem({ productId: "prod-1", quantity: 1 })
      )
    ).rejects.toThrow(/out of stock/);
  });

  it("uses sku rather than productId when the input provides a sku (variant selection)", async () => {
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

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
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

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
    mockManageCarts.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

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
});

describe("epUpdateCartItem", () => {
  it("updates an item's quantity on the session cart and returns the normalized cart", async () => {
    mockUpdateACartItem.mockResolvedValue({});
    mockGetACart.mockResolvedValue(CART_RESPONSE);

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

  it("throws when called without an active EP session", async () => {
    await expect(
      epUpdateCartItem({ itemId: "item-1", quantity: 1 })
    ).rejects.toThrow(/no EP session/i);
  });

  it("throws when the session has no cartId (nothing to update against)", async () => {
    await expect(
      withEpSession(SESSION_BASE, () =>
        epUpdateCartItem({ itemId: "item-1", quantity: 1 })
      )
    ).rejects.toThrow(/no cart/i);
    expect(mockUpdateACartItem).not.toHaveBeenCalled();
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

  it("throws when called without an active EP session", async () => {
    await expect(epRemoveCartItem({ itemId: "item-1" })).rejects.toThrow(
      /no EP session/i
    );
  });

  it("throws when the session has no cartId (nothing to remove from)", async () => {
    await expect(
      withEpSession(SESSION_BASE, () => epRemoveCartItem({ itemId: "item-1" }))
    ).rejects.toThrow(/no cart/i);
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
  });
});
