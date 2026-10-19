/**
 * epPlaceOrder for a signed-in account member, run the way a host runs it:
 * `withEpSession(buildEpCtx(session))` over an in-memory Elastic Path store.
 */
const sdkImpl: Record<string, (...args: any[]) => any> = {};

jest.mock("@epcc-sdk/sdks-shopper", () => {
  const names = ["getACart", "updateACart", "checkoutApi", "paymentSetup", "deleteAllCartItems"];
  return {
    ...Object.fromEntries(
      names.map((name) => [name, (...args: unknown[]) => sdkImpl[name](...args)])
    ),
    createShopperClient: jest.fn(
      require("../../checkout/session/__tests__/fake-shopper-client").fakeShopperClient
    ),
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const { epPlaceOrder } = require("../place-order") as typeof import("../place-order");
const { withEpSession } = require("../session-context") as typeof import("../session-context");
const { buildEpCtx } = require("../build-ep-ctx") as typeof import("../build-ep-ctx");
const { FakeEpStore } =
  require("../../checkout/session/__tests__/fake-ep-store") as typeof import("../../checkout/session/__tests__/fake-ep-store");
/* eslint-enable @typescript-eslint/no-var-requires */

let ep: InstanceType<typeof FakeEpStore>;

beforeEach(() => {
  ep = new FakeEpStore();
  for (const key of Object.keys(sdkImpl)) delete sdkImpl[key];
  Object.assign(sdkImpl, ep.sdk());
  ep.addCart("cart-1", [{ product_id: "p-1", sku: "p-1", quantity: 1, unit_price: { amount: 2200 } }]);
  ep.accountTokens.add("account-token-a");
});

function sessionFor(identity: {
  memberId?: string;
  account?: { id: string; token: string };
}) {
  return {
    session: {
      accessToken: "implicit-token",
      expires: 0,
      clientId: "client",
      host: "https://api.test.com",
      memberId: identity.memberId,
      account: identity.account
        ? { ...identity.account, name: "Account A", expires: 0 }
        : null,
      lapsedAccount: null,
    },
    cart: { id: "cart-1" },
  };
}

function placeOrder(session: ReturnType<typeof sessionFor>) {
  return withEpSession(buildEpCtx(session), () =>
    epPlaceOrder(
      {
        customer: { name: "Ada Lovelace", email: "ada@example.com" },
        billingAddress: { first_name: "Ada", last_name: "Lovelace", line_1: "1 Way", city: "London", postcode: "EC1", country: "GB" },
      },
      { allowManual: () => true }
    )
  );
}

function linkOf(order: (typeof ep.orders)[number]) {
  return {
    account: order.account ?? null,
    member: order.accountMember ?? null,
    contact: order.contact ?? null,
    customer: order.customer ?? null,
  };
}

const ADA = { name: "Ada Lovelace", email: "ada@example.com" };

describe("epPlaceOrder for an account member", () => {
  it("places the order for the selected account and member, with the account's credential", async () => {
    const result = await placeOrder(
      sessionFor({ memberId: "member-1", account: { id: "account-a", token: "account-token-a" } })
    );

    expect(result.status).toBe("complete");
    expect(ep.orders.map(linkOf)).toEqual([
      { account: "account-a", member: "member-1", contact: ADA, customer: null },
    ]);
    expect(ep.orders[0].accountTokenSent).toBe("account-token-a");
    expect(ep.cart("cart-1").lines).toEqual([]);
  });

  it("places a guest order for a member with no selected account", async () => {
    await placeOrder(sessionFor({ memberId: "member-1" }));

    expect(ep.orders.map(linkOf)).toEqual([
      { account: null, member: null, contact: null, customer: ADA },
    ]);
  });

  it("places a guest order for an anonymous shopper", async () => {
    await placeOrder(sessionFor({}));

    expect(ep.orders.map(linkOf)).toEqual([
      { account: null, member: null, contact: null, customer: ADA },
    ]);
  });
});
