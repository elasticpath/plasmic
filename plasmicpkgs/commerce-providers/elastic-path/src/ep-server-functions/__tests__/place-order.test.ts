const mockCheckoutApi = jest.fn();
const mockPaymentSetup = jest.fn();
const mockDeleteAllCartItems = jest.fn();
const mockUpdateACart = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  checkoutApi: (...args: unknown[]) => mockCheckoutApi(...args),
  paymentSetup: (...args: unknown[]) => mockPaymentSetup(...args),
  deleteAllCartItems: (...args: unknown[]) => mockDeleteAllCartItems(...args),
  updateACart: (...args: unknown[]) => mockUpdateACart(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  epPlaceOrder,
  toCustomAttributes,
  normalizeAddress,
} = require("../place-order");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION_BASE = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const ORDER_RESPONSE = (amount: number) => ({
  data: {
    data: {
      id: "order-1",
      type: "order",
      status: "complete",
      payment: "paid",
      meta: {
        display_price: {
          with_tax: { amount, currency: "CHF", formatted: `CHF ${amount / 100}` },
        },
      },
    },
  },
});

const BILLING = {
  first_name: "Ada",
  last_name: "Lovelace",
  line_1: "1 Analytical Way",
  city: "London",
  postcode: "EC1",
  country: "GB",
};

beforeEach(() => {
  mockCheckoutApi.mockReset();
  mockPaymentSetup.mockReset();
  mockDeleteAllCartItems.mockReset();
  mockUpdateACart.mockReset();
});

describe("toCustomAttributes", () => {
  it("types values by JS runtime type and drops empties", () => {
    const out = toCustomAttributes({
      industry: "Engineering",
      marketing: true,
      seats: 3,
      ratio: 1.5,
      blank: "",
    });
    expect(out).toEqual({
      industry: { type: "string", value: "Engineering" },
      marketing: { type: "boolean", value: true },
      seats: { type: "integer", value: 3 },
      ratio: { type: "float", value: 1.5 },
    });
  });

  it("returns undefined when nothing meaningful remains", () => {
    expect(toCustomAttributes(undefined)).toBeUndefined();
    expect(toCustomAttributes({ a: "" })).toBeUndefined();
  });
});

describe("normalizeAddress", () => {
  it("fills missing parts with empty strings", () => {
    expect(normalizeAddress({ first_name: "Ada", country: "GB" })).toEqual({
      first_name: "Ada",
      last_name: "",
      company_name: "",
      line_1: "",
      line_2: "",
      city: "",
      county: "",
      postcode: "",
      country: "GB",
    });
  });
});

describe("epPlaceOrder", () => {
  it("checks out, takes manual payment, clears the cart, and reports the order", async () => {
    mockCheckoutApi.mockResolvedValue(ORDER_RESPONSE(91900));
    mockPaymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });
    mockDeleteAllCartItems.mockResolvedValue({});

    const result = await withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
      epPlaceOrder({
        customer: { name: "Ada Lovelace", email: "ada@ep.com" },
        billingAddress: BILLING,
      })
    );

    expect(mockCheckoutApi).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-1" },
        body: {
          data: expect.objectContaining({
            customer: { name: "Ada Lovelace", email: "ada@ep.com" },
            billing_address: expect.objectContaining({ country: "GB" }),
          }),
        },
      })
    );
    // Shipping defaults to billing when none provided (EP needs one for
    // shippable items).
    expect(
      mockCheckoutApi.mock.calls[0][0].body.data.shipping_address
    ).toEqual(expect.objectContaining({ country: "GB" }));
    expect(mockPaymentSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { orderID: "order-1" },
        body: { data: { gateway: "manual", method: "purchase" } },
      })
    );
    expect(mockDeleteAllCartItems).toHaveBeenCalledWith(
      expect.objectContaining({ path: { cartID: "cart-1" } })
    );
    expect(result).toEqual({
      orderId: "order-1",
      status: "complete",
      payment: "paid",
      total: 91900,
      currency: "CHF",
      isFree: false,
    });
  });

  it("flags a zero-total order as free and still completes it via manual purchase", async () => {
    mockCheckoutApi.mockResolvedValue(ORDER_RESPONSE(0));
    mockPaymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });
    mockDeleteAllCartItems.mockResolvedValue({});

    const result = await withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
      epPlaceOrder({
        customer: { name: "Ada Lovelace", email: "ada@ep.com" },
        billingAddress: BILLING,
      })
    );

    expect(result.isFree).toBe(true);
    expect(result.total).toBe(0);
    expect(mockPaymentSetup).toHaveBeenCalled();
  });

  it("persists extra fields + consents as typed cart custom attributes before checkout", async () => {
    mockCheckoutApi.mockResolvedValue(ORDER_RESPONSE(0));
    mockPaymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });
    mockDeleteAllCartItems.mockResolvedValue({});

    await withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
      epPlaceOrder({
        customer: { name: "Ada Lovelace", email: "ada@ep.com" },
        billingAddress: BILLING,
        customAttributes: { industry: "Engineering", marketing: true },
      })
    );

    expect(mockUpdateACart).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { cartID: "cart-1" },
        body: {
          data: {
            custom_attributes: {
              industry: { type: "string", value: "Engineering" },
              marketing: { type: "boolean", value: true },
            },
          },
        },
      })
    );
    // custom-attributes write happens before checkout
    expect(mockUpdateACart.mock.invocationCallOrder[0]).toBeLessThan(
      mockCheckoutApi.mock.invocationCallOrder[0]
    );
  });

  it("skips the custom-attributes write when there is nothing to persist", async () => {
    mockCheckoutApi.mockResolvedValue(ORDER_RESPONSE(0));
    mockPaymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });
    mockDeleteAllCartItems.mockResolvedValue({});

    await withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
      epPlaceOrder({
        customer: { name: "Ada Lovelace", email: "ada@ep.com" },
        billingAddress: BILLING,
      })
    );
    expect(mockUpdateACart).not.toHaveBeenCalled();
  });

  it("respects clearCart:false (cart left intact)", async () => {
    mockCheckoutApi.mockResolvedValue(ORDER_RESPONSE(0));
    mockPaymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });

    await withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
      epPlaceOrder({
        customer: { name: "Ada Lovelace", email: "ada@ep.com" },
        billingAddress: BILLING,
        clearCart: false,
      })
    );
    expect(mockDeleteAllCartItems).not.toHaveBeenCalled();
  });

  it("allows a store to override gateway + method for a real paid order", async () => {
    mockCheckoutApi.mockResolvedValue(ORDER_RESPONSE(91900));
    mockPaymentSetup.mockResolvedValue({ data: { data: { status: "authorized" } } });
    mockDeleteAllCartItems.mockResolvedValue({});

    await withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
      epPlaceOrder({
        customer: { name: "Ada Lovelace", email: "ada@ep.com" },
        billingAddress: BILLING,
        paymentGateway: "stripe_connect",
        paymentMethod: "authorize",
      })
    );
    expect(mockPaymentSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { data: { gateway: "stripe_connect", method: "authorize" } },
      })
    );
  });

  it("omits shipping_address when shippingSameAsBilling is false", async () => {
    mockCheckoutApi.mockResolvedValue(ORDER_RESPONSE(0));
    mockPaymentSetup.mockResolvedValue({ data: { data: { status: "paid" } } });
    mockDeleteAllCartItems.mockResolvedValue({});

    await withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
      epPlaceOrder({
        customer: { name: "Ada Lovelace", email: "ada@ep.com" },
        billingAddress: BILLING,
        shippingSameAsBilling: false,
      })
    );
    expect(
      mockCheckoutApi.mock.calls[0][0].body.data.shipping_address
    ).toBeUndefined();
  });

  it("throws when the session has no cart", async () => {
    await expect(
      withEpSession(SESSION_BASE, () =>
        epPlaceOrder({
          customer: { name: "Ada Lovelace", email: "ada@ep.com" },
          billingAddress: BILLING,
        })
      )
    ).rejects.toThrow(/no cart/i);
    expect(mockCheckoutApi).not.toHaveBeenCalled();
  });

  it("throws when checkout returns no order", async () => {
    mockCheckoutApi.mockResolvedValue({ data: { data: null } });
    await expect(
      withEpSession({ ...SESSION_BASE, cartId: "cart-1" }, () =>
        epPlaceOrder({
          customer: { name: "Ada Lovelace", email: "ada@ep.com" },
          billingAddress: BILLING,
        })
      )
    ).rejects.toThrow(/did not return an order/i);
  });
});
