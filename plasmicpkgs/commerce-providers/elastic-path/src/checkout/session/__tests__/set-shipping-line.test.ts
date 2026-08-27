const mockGetACart = jest.fn();
const mockManageCarts = jest.fn();
const mockDeleteACartItem = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getACart: (...args: unknown[]) => mockGetACart(...args),
  manageCarts: (...args: unknown[]) => mockManageCarts(...args),
  deleteACartItem: (...args: unknown[]) => mockDeleteACartItem(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  setCartShippingLine,
  clearCartShippingLine,
  EP_SHIPPING_LINE_SKU,
} = require("../set-shipping-line") as {
  setCartShippingLine: typeof import("../set-shipping-line").setCartShippingLine;
  clearCartShippingLine: typeof import("../set-shipping-line").clearCartShippingLine;
  EP_SHIPPING_LINE_SKU: string;
};

const CLIENT = { __isClient: true } as unknown as never;

const RATE = {
  id: "rate-express",
  name: "Express",
  amount: 1500,
  currency: "CHF",
  serviceLevel: "express",
  carrier: "DHL",
};

function cartWith(items: Array<Record<string, unknown>>) {
  return {
    data: {
      data: {
        id: "cart-id",
        type: "cart",
        attributes: { name: "Cart" },
        meta: {
          display_price: {
            with_tax: { amount: 6500, currency: "CHF", formatted: "CHF65.00" },
            without_tax: { amount: 6500, currency: "CHF", formatted: "CHF65.00" },
          },
        },
      },
      included: { items },
    },
  };
}

beforeEach(() => {
  mockGetACart.mockReset();
  mockManageCarts.mockReset();
  mockDeleteACartItem.mockReset();
  mockGetACart.mockResolvedValue(cartWith([])); // default: empty cart for both reads
  mockManageCarts.mockResolvedValue({});
  mockDeleteACartItem.mockResolvedValue({});
});

describe("setCartShippingLine — write", () => {
  it("writes a custom_item shipping line carrying the SERVER amount + sentinel sku", async () => {
    const result = await setCartShippingLine(CLIENT, { cartId: "cart-id", rate: RATE });

    expect(mockManageCarts).toHaveBeenCalledTimes(1);
    const body = mockManageCarts.mock.calls[0][0].body.data;
    expect(body).toEqual(
      expect.objectContaining({
        type: "custom_item",
        name: "Express",
        sku: EP_SHIPPING_LINE_SKU,
        quantity: 1,
        price: { amount: 1500, includes_tax: true },
      })
    );
    expect(body.custom_inputs).toEqual(
      expect.objectContaining({ kind: "shipping", rateId: "rate-express", carrier: "DHL", serviceLevel: "express" })
    );
    expect(result.id).toBe("cart-id");
  });

  it("falls back to a 'Shipping' name when the rate has no name", async () => {
    await setCartShippingLine(CLIENT, {
      cartId: "cart-id",
      rate: { ...RATE, name: "" },
    });
    expect(mockManageCarts.mock.calls[0][0].body.data.name).toBe("Shipping");
  });

  it("accepts a 0-amount (free) shipping rate", async () => {
    await setCartShippingLine(CLIENT, { cartId: "cart-id", rate: { ...RATE, amount: 0 } });
    expect(mockManageCarts.mock.calls[0][0].body.data.price.amount).toBe(0);
  });

  it("re-reads the cart with locale/currency headers so the returned total is re-priced", async () => {
    await setCartShippingLine(CLIENT, {
      cartId: "cart-id",
      rate: RATE,
      locale: "de-DE",
      currency: "EUR",
    });
    // call[0] = idempotency read (no headers); call[1] = re-read (headers).
    const reread = mockGetACart.mock.calls[1][0];
    expect(reread.headers).toEqual({ "Accept-Language": "de-DE", "X-Moltin-Currency": "EUR" });
  });
});

describe("setCartShippingLine — idempotency (replace, never stack)", () => {
  it("removes an existing managed shipping line before adding the new one", async () => {
    mockGetACart.mockResolvedValueOnce(
      cartWith([
        { id: "old-ship", sku: EP_SHIPPING_LINE_SKU },
        { id: "prod-1", sku: "BOOK-1" },
      ])
    ); // first read sees a stale shipping line + a catalog line

    await setCartShippingLine(CLIENT, { cartId: "cart-id", rate: RATE });

    expect(mockDeleteACartItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteACartItem).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-id", cartitemID: "old-ship" } })
    );
    // the new line is still written
    expect(mockManageCarts).toHaveBeenCalledTimes(1);
  });

  it("never deletes catalog lines — only the sentinel-sku shipping line", async () => {
    mockGetACart.mockResolvedValueOnce(
      cartWith([
        { id: "prod-1", sku: "BOOK-1" },
        { id: "prod-2" },
      ])
    );
    await setCartShippingLine(CLIENT, { cartId: "cart-id", rate: RATE });
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
  });

  it("clears multiple stale shipping lines defensively", async () => {
    mockGetACart.mockResolvedValueOnce(
      cartWith([
        { id: "ship-a", sku: EP_SHIPPING_LINE_SKU },
        { id: "ship-b", sku: EP_SHIPPING_LINE_SKU },
        { id: "prod-1", sku: "BOOK-1" },
      ])
    );
    await setCartShippingLine(CLIENT, { cartId: "cart-id", rate: RATE });
    expect(mockDeleteACartItem).toHaveBeenCalledTimes(2);
    const deletedIds = mockDeleteACartItem.mock.calls.map((c) => c[0].path.cartitemID).sort();
    expect(deletedIds).toEqual(["ship-a", "ship-b"]);
  });

  it("does not delete when there is no existing shipping line", async () => {
    await setCartShippingLine(CLIENT, { cartId: "cart-id", rate: RATE });
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
    expect(mockManageCarts).toHaveBeenCalledTimes(1);
  });
});

describe("setCartShippingLine — bounds & errors", () => {
  it("throws (no SDK calls) on a missing cartId", async () => {
    await expect(
      setCartShippingLine(CLIENT, { cartId: "", rate: RATE })
    ).rejects.toThrow(/cartId is required/i);
    expect(mockGetACart).not.toHaveBeenCalled();
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("throws (no SDK calls) on a malformed rate (non-numeric amount)", async () => {
    await expect(
      setCartShippingLine(CLIENT, { cartId: "cart-id", rate: { ...RATE, amount: "free" as never } })
    ).rejects.toThrow(/resolved shipping rate with a numeric amount/i);
    expect(mockGetACart).not.toHaveBeenCalled();
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("propagates the underlying SDK error when the write is rejected", async () => {
    mockManageCarts.mockRejectedValue(
      Object.assign(new Error("cart locked"), { status: 409 })
    );
    await expect(
      setCartShippingLine(CLIENT, { cartId: "cart-id", rate: RATE })
    ).rejects.toThrow(/cart locked/);
  });
});

describe("clearCartShippingLine", () => {
  it("deletes only sentinel-sku managed shipping lines", async () => {
    mockGetACart.mockResolvedValueOnce(
      cartWith([
        { id: "ship-1", sku: EP_SHIPPING_LINE_SKU },
        { id: "prod-1", sku: "BOOK-1" },
        { id: "fee-1", sku: "custom-fee" },
      ])
    );

    const result = await clearCartShippingLine(CLIENT, { cartId: "cart-id" });

    expect(result.deletedCount).toBe(1);
    expect(mockDeleteACartItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteACartItem).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-id", cartitemID: "ship-1" } })
    );
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("leaves catalog and other custom lines untouched", async () => {
    mockGetACart.mockResolvedValueOnce(
      cartWith([
        { id: "prod-1", sku: "BOOK-1" },
        { id: "adj-1", sku: "store-fee" },
      ])
    );

    const result = await clearCartShippingLine(CLIENT, { cartId: "cart-id" });

    expect(result.deletedCount).toBe(0);
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
  });

  it("deletes every matching __ep_shipping line defensively", async () => {
    mockGetACart.mockResolvedValueOnce(
      cartWith([
        { id: "ship-a", sku: EP_SHIPPING_LINE_SKU },
        { id: "ship-b", sku: EP_SHIPPING_LINE_SKU },
        { id: "prod-1", sku: "BOOK-1" },
      ])
    );

    const result = await clearCartShippingLine(CLIENT, { cartId: "cart-id" });

    expect(result.deletedCount).toBe(2);
    expect(mockDeleteACartItem).toHaveBeenCalledTimes(2);
    const deletedIds = mockDeleteACartItem.mock.calls
      .map((c) => c[0].path.cartitemID)
      .sort();
    expect(deletedIds).toEqual(["ship-a", "ship-b"]);
  });

  it("no-ops when no managed shipping line exists", async () => {
    mockGetACart.mockResolvedValueOnce(cartWith([{ id: "prod-1", sku: "BOOK-1" }]));

    const result = await clearCartShippingLine(CLIENT, { cartId: "cart-id" });

    expect(result.deletedCount).toBe(0);
    expect(mockDeleteACartItem).not.toHaveBeenCalled();
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("throws (no SDK calls) on a missing cartId", async () => {
    await expect(clearCartShippingLine(CLIENT, { cartId: "" })).rejects.toThrow(
      /cartId is required/i
    );
    expect(mockGetACart).not.toHaveBeenCalled();
  });
});
