const mockManageCarts = jest.fn();
const mockGetACart = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  manageCarts: (...args: unknown[]) => mockManageCarts(...args),
  getACart: (...args: unknown[]) => mockGetACart(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  addCustomCartItem,
  CART_ADJUSTMENT_KINDS,
} = require("../custom-cart-item");

// A dummy client — the primitive only passes it through to the mocked SDK.
const CLIENT = { __isClient: true } as unknown;

const CART_RESPONSE = {
  data: {
    data: {
      id: "cart-id",
      type: "cart",
      attributes: { name: "Cart" },
      meta: {
        display_price: {
          with_tax: { amount: 5500, currency: "USD", formatted: "$55.00" },
          without_tax: { amount: 5500, currency: "USD", formatted: "$55.00" },
        },
      },
    },
    included: { items: [] },
  },
};

beforeEach(() => {
  mockManageCarts.mockReset();
  mockGetACart.mockReset();
  mockManageCarts.mockResolvedValue({});
  mockGetACart.mockResolvedValue(CART_RESPONSE);
});

describe("addCustomCartItem — payload", () => {
  it("writes a custom_item with the label as name, amountMinor as price, default quantity 1, and the kind tag", async () => {
    const result = await addCustomCartItem(CLIENT, {
      cartId: "cart-id",
      label: "Handling fee",
      amountMinor: 500,
      kind: "handling",
    });

    expect(mockManageCarts).toHaveBeenCalledTimes(1);
    const body = mockManageCarts.mock.calls[0][0].body.data;
    expect(body).toEqual(
      expect.objectContaining({
        type: "custom_item",
        name: "Handling fee",
        quantity: 1,
        price: { amount: 500, includes_tax: true },
        custom_inputs: { kind: "handling" },
      })
    );
    expect(mockManageCarts.mock.calls[0][0].path).toEqual({ cartID: "cart-id" });
    // Returns the re-priced, normalized cart.
    expect(result.id).toBe("cart-id");
  });

  it("honours an explicit quantity", async () => {
    await addCustomCartItem(CLIENT, {
      cartId: "cart-id",
      label: "Per-item surcharge",
      amountMinor: 100,
      kind: "fee",
      quantity: 3,
    });
    expect(mockManageCarts.mock.calls[0][0].body.data.quantity).toBe(3);
  });

  it("re-reads the cart with locale/currency headers so the returned total is re-priced", async () => {
    await addCustomCartItem(CLIENT, {
      cartId: "cart-id",
      label: "Fee",
      amountMinor: 200,
      kind: "fee",
      locale: "de-DE",
      currency: "EUR",
    });
    const read = mockGetACart.mock.calls[0][0];
    expect(read.query).toEqual({ include: ["items"] });
    expect(read.headers).toEqual({
      "Accept-Language": "de-DE",
      "X-Moltin-Currency": "EUR",
    });
  });

  it("accepts a zero amount (a free, labelled line)", async () => {
    await addCustomCartItem(CLIENT, {
      cartId: "cart-id",
      label: "Free gift wrap",
      amountMinor: 0,
      kind: "fee",
    });
    expect(mockManageCarts.mock.calls[0][0].body.data.price.amount).toBe(0);
  });

  it("accepts every allowed kind", async () => {
    for (const kind of CART_ADJUSTMENT_KINDS) {
      mockManageCarts.mockClear();
      await addCustomCartItem(CLIENT, {
        cartId: "cart-id",
        label: "Adj",
        amountMinor: 100,
        kind,
      });
      expect(mockManageCarts.mock.calls[0][0].body.data.custom_inputs.kind).toBe(
        kind
      );
    }
  });
});

describe("addCustomCartItem — bounds (reject before any network call)", () => {
  it("rejects a negative amount (no discounts via this path)", async () => {
    await expect(
      addCustomCartItem(CLIENT, {
        cartId: "cart-id",
        label: "Discount",
        amountMinor: -500,
        kind: "fee",
      })
    ).rejects.toThrow(/non-negative integer/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("rejects a non-integer amount", async () => {
    await expect(
      addCustomCartItem(CLIENT, {
        cartId: "cart-id",
        label: "Fee",
        amountMinor: 4.99,
        kind: "fee",
      })
    ).rejects.toThrow(/integer/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("rejects a missing/blank label", async () => {
    await expect(
      addCustomCartItem(CLIENT, {
        cartId: "cart-id",
        label: "   ",
        amountMinor: 500,
        kind: "fee",
      })
    ).rejects.toThrow(/label is required/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("rejects a kind outside the enum", async () => {
    await expect(
      addCustomCartItem(CLIENT, {
        cartId: "cart-id",
        label: "Fee",
        amountMinor: 500,
        kind: "discount" as never,
      })
    ).rejects.toThrow(/kind must be one of/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("rejects a missing cartId", async () => {
    await expect(
      addCustomCartItem(CLIENT, {
        cartId: "",
        label: "Fee",
        amountMinor: 500,
        kind: "fee",
      })
    ).rejects.toThrow(/cartId is required/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity", async () => {
    await expect(
      addCustomCartItem(CLIENT, {
        cartId: "cart-id",
        label: "Fee",
        amountMinor: 500,
        kind: "fee",
        quantity: 0,
      })
    ).rejects.toThrow(/quantity must be a positive integer/i);
    expect(mockManageCarts).not.toHaveBeenCalled();
  });
});

describe("addCustomCartItem — error propagation", () => {
  it("propagates the underlying SDK error when EP rejects the write", async () => {
    mockManageCarts.mockRejectedValue(
      Object.assign(new Error("cart locked"), { status: 409 })
    );
    await expect(
      addCustomCartItem(CLIENT, {
        cartId: "cart-id",
        label: "Fee",
        amountMinor: 500,
        kind: "fee",
      })
    ).rejects.toThrow(/cart locked/);
  });
});
