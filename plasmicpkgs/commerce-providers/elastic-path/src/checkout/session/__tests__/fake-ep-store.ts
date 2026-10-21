/**
 * An in-memory Elastic Path store for checkout handler tests. Every call
 * yields to the event loop before and after it acts, so concurrent requests
 * interleave the way they do against the real API. Adding a custom item whose
 * SKU is already in the cart raises that line's quantity, as Elastic Path does.
 */
import type { FakeShopperClient } from "./fake-shopper-client";

const ACCOUNT_TOKEN_HEADER = "ep-account-management-authentication-token";

/** The account token a client's request interceptors put on a request. */
async function accountTokenSentBy(client: FakeShopperClient | undefined): Promise<string | undefined> {
  if (!client?.intercepts) return undefined;
  const headers = new Map<string, string>();
  let request: any = {
    headers: { set: (name: string, value: string) => headers.set(name.toLowerCase(), value) },
  };
  for (const intercept of client.intercepts) request = await intercept(request);
  return headers.get(ACCOUNT_TOKEN_HEADER);
}

interface CheckoutBody {
  customer?: { name?: string; email?: string };
  contact?: { name?: string; email?: string };
  account?: { id?: string; member_id?: string };
}

/**
 * Elastic Path's checks on a checkout body, as measured on the integration
 * store: an order is for a guest `customer`, or for an `account` with a
 * `contact`, never both.
 */
function checkoutBodyErrors(body: CheckoutBody): string[] {
  if (body.customer && body.contact) {
    return ["only one of data.customer or data.contact can be provided"];
  }
  if (body.account) {
    if (!body.contact) {
      return [
        "contact is required to checkout when account id or account member id is provided in the header or body",
      ];
    }
    return body.account.id ? [] : ["id is required"];
  }
  if (body.contact) return ["account id is required to checkout when contact is provided"];
  return body.customer ? [] : ["data.customer or data.contact must be provided"];
}

export interface FakeLine {
  id: string;
  type: string;
  sku?: string;
  product_id?: string;
  name?: string;
  quantity: number;
  unit_price: { amount: number };
  value: { amount: number };
  custom_inputs?: Record<string, unknown>;
  /**
   * A `promotion_item` worth this percent off every other line, shipping
   * included: Elastic Path re-prices it whenever the cart changes.
   */
  percentOff?: number;
}

export interface FakeOrder {
  id: string;
  cartId: string;
  status: string;
  payment: string;
  total: number;
  paid: number;
  /** Copied from the cart at checkout; a confirm consumes it, as Elastic Path does. */
  paymentIntentId?: string;
  lines: Array<{ sku?: string; quantity: number; amount: number; productId?: string }>;
  /** The cart line each order item came from, as `relationships.cart_item`. */
  cartItems: Array<{ cartItemId: string; sku?: string; quantity: number; productId?: string }>;
  externalRef?: string;
  transactions: Array<{ id: string; status: "pending" | "complete" | "cancelled"; piId: string }>;
  /** A guest order's `customer`, or an account order's `contact`. */
  customer?: { name?: string; email?: string };
  contact?: { name?: string; email?: string };
  /** `relationships.account` and `relationships.account_member`. */
  account?: string;
  accountMember?: string;
  /** The account token the checkout request carried, if any. */
  accountTokenSent?: string;
  /** Order flow fields written after checkout. */
  fields: Record<string, unknown>;
}

export interface FakePaymentIntent {
  id: string;
  amount: number;
  status: "requires_action" | "succeeded" | "requires_payment_method" | "canceled";
}

interface FakeCart {
  lines: FakeLine[];
  deleted: boolean;
  paymentIntentId?: string;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Re-prices percent promotions against the rest of the cart, as Elastic Path does. */
function repricePromotions(cart: FakeCart): void {
  const base = cart.lines
    .filter((l) => l.percentOff === undefined)
    .reduce((sum, l) => sum + l.unit_price.amount * l.quantity, 0);
  for (const l of cart.lines) {
    if (l.percentOff === undefined) continue;
    l.unit_price = { amount: -Math.round((base * l.percentOff) / 100) };
    l.value = { amount: l.unit_price.amount * l.quantity };
  }
}

/**
 * A line's priced value after the cart's percent promotions, the way Elastic
 * Path reports it in `meta.display_price`. Promotion lines carry none.
 */
function linePricing(cart: FakeCart, line: FakeLine): Record<string, unknown> {
  if (line.percentOff !== undefined) return {};
  const promotions = cart.lines.filter((l) => l.percentOff !== undefined);
  const before = line.unit_price.amount * line.quantity;
  const discounts: Record<string, { amount: number; currency: string }> = {};
  let discount = 0;
  for (const p of promotions) {
    const off = -Math.round((before * p.percentOff!) / 100);
    discount += off;
    if (p.sku) discounts[p.sku] = { amount: off, currency: "USD" };
  }
  const money = (amount: number) => ({
    unit: { amount: Math.round(amount / line.quantity), currency: "USD" },
    value: { amount, currency: "USD" },
  });
  return {
    meta: {
      display_price: {
        with_tax: money(before + discount),
        without_tax: money(before + discount),
        tax: money(0),
        discount: money(discount),
        without_discount: money(before),
        discounts,
      },
    },
  };
}

function cartTotal(cart: FakeCart): number {
  repricePromotions(cart);
  return cart.lines.reduce(
    (sum, l) => sum + l.unit_price.amount * l.quantity,
    0
  );
}

export class FakeEpStore {
  /** The store currency, on cart and order totals. */
  currency = "USD";
  carts = new Map<string, FakeCart>();
  orders: FakeOrder[] = [];
  /** Amounts taken by a cart PaymentIntent, one entry per charge. */
  charges: number[] = [];
  paymentIntents = new Map<string, FakePaymentIntent>();
  /** Order items arrive without the cart line they came from. */
  orderItemsWithoutCartLines = false;
  /**
   * Carts that are the last cart of an account: Elastic Path refuses to delete
   * them (400 "Last cart") but lets their items be deleted.
   */
  lastAccountCarts = new Set<string>();
  /** Carts whose items Elastic Path will not delete (a store outage). */
  undeletableItems = new Set<string>();
  /** Stock-tracked products: units allocated (order confirm allocates, as Elastic Path does). */
  allocated = new Map<string, number>();
  /** Transaction cancels answer a server error while true. */
  cancelFails = false;
  /** Runs just before a transaction cancel acts (to land a race there). */
  beforeCancel: (() => void) | null = null;
  /** The next checkouts answer this Elastic Path error instead of an order. */
  checkoutRejection: { status: number; detail: string } | null = null;
  /**
   * Account tokens Elastic Path can read. A checkout that sends any other
   * account token is refused with 403, as Elastic Path refuses one it cannot read.
   */
  accountTokens = new Set<string>();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  addCart(
    cartId: string,
    lines: Array<
      Partial<FakeLine> & { quantity: number; unit_price: { amount: number } }
    >
  ): void {
    this.carts.set(cartId, {
      deleted: false,
      lines: lines.map((l) => ({
        id: l.id ?? this.nextId("line"),
        type: l.type ?? "cart_item",
        sku: l.sku,
        product_id: l.product_id,
        ...(l.name !== undefined ? { name: l.name } : {}),
        quantity: l.quantity,
        unit_price: { amount: l.unit_price.amount },
        value: { amount: l.unit_price.amount * l.quantity },
        ...(l.percentOff !== undefined ? { percentOff: l.percentOff } : {}),
      })),
    });
  }

  cart(cartId: string): FakeCart {
    const cart = this.carts.get(cartId);
    if (!cart || cart.deleted) {
      throw new Error(`no cart ${cartId}`);
    }
    return cart;
  }

  total(cartId: string): number {
    return cartTotal(this.cart(cartId));
  }

  /** The shopper applies a percent-off code: Elastic Path adds a promotion line. */
  applyPromotion(cartId: string, code: string, percentOff: number): void {
    this.cart(cartId).lines.push({
      id: this.nextId("line"),
      type: "promotion_item",
      sku: code,
      quantity: 1,
      unit_price: { amount: 0 },
      value: { amount: 0 },
      percentOff,
    });
  }

  /** The shopper changes a line's quantity (on another page or tab). */
  setQuantity(cartId: string, sku: string, quantity: number): void {
    const line = this.cart(cartId).lines.find((l) => l.sku === sku);
    if (!line) throw new Error(`no line ${sku} in ${cartId}`);
    line.quantity = quantity;
  }

  linesWithSku(cartId: string, sku: string): FakeLine[] {
    return this.cart(cartId).lines.filter((l) => l.sku === sku);
  }

  /** Replaces the module `@epcc-sdk/sdks-shopper` functions the checkout uses. */
  sdk() {
    const store = this;
    const read = (cartID: string) => {
      const cart = store.carts.get(cartID);
      if (!cart || cart.deleted) {
        return {
          data: undefined,
          error: { errors: [{ status: 404, detail: "cart not found" }] },
        };
      }
      const amount = cartTotal(cart);
      // cartTotal re-priced the promotions; the lines below carry the new values.
      return {
        data: {
          data: {
            id: cartID,
            type: "cart",
            ...(cart.paymentIntentId
              ? { payment_intent_id: cart.paymentIntentId }
              : {}),
            meta: {
              display_price: {
                with_tax: { amount, currency: store.currency },
                without_tax: { amount, currency: store.currency },
                tax: { amount: 0, currency: store.currency },
              },
            },
          },
          included: {
            items: cart.lines.map((l) => ({
              ...l,
              value: { amount: l.unit_price.amount * l.quantity },
              ...linePricing(cart, l),
            })),
          },
        },
      };
    };
    const after = async <T>(fn: () => T): Promise<T> => {
      await tick();
      const out = fn();
      await tick();
      return out;
    };
    return {
      getACart: ({ path }: any) => after(() => read(path.cartID)),
      manageCarts: ({ path, body }: any) =>
        after(() => {
          const cart = store.cart(path.cartID);
          const data = body.data;
          const same = cart.lines.find((l) => data.sku && l.sku === data.sku);
          if (same) {
            same.quantity += data.quantity;
          } else {
            cart.lines.push({
              id: store.nextId("line"),
              type: data.type,
              sku: data.sku,
              name: data.name,
              quantity: data.quantity,
              unit_price: { amount: data.price.amount },
              value: { amount: data.price.amount * data.quantity },
              custom_inputs: data.custom_inputs,
            });
          }
          const cartRead = read(path.cartID).data!;
          return {
            data: { data: cartRead.included.items, meta: cartRead.data.meta },
          };
        }),
      deleteACartItem: ({ path }: any) =>
        after(() => {
          if (store.undeletableItems.has(path.cartID)) {
            return { error: { errors: [{ status: 503 }] }, response: { status: 503 } };
          }
          const cart = store.cart(path.cartID);
          cart.lines = cart.lines.filter((l) => l.id !== path.cartitemID);
          return read(path.cartID);
        }),
      updateACartItem: ({ path, body }: any) =>
        after(() => {
          const cart = store.cart(path.cartID);
          const line = cart.lines.find((l) => l.id === path.cartitemID);
          if (line && typeof body?.data?.quantity === "number") {
            line.quantity = body.data.quantity;
          }
          return read(path.cartID);
        }),
      updateACart: ({ path, body }: any) =>
        after(() => {
          const cart = store.carts.get(path.cartID);
          if (cart && body?.data && "payment_intent_id" in body.data) {
            cart.paymentIntentId = body.data.payment_intent_id || undefined;
          }
          return { data: { data: {} } };
        }),
      deleteACart: ({ path }: any) =>
        after(() => {
          if (store.lastAccountCarts.has(path.cartID)) {
            return {
              error: {
                errors: [
                  {
                    status: 400,
                    title: "Last cart",
                    detail:
                      "This is the last cart associated with an account and it cannot be deleted, try disassociating instead",
                  },
                ],
              },
              response: { status: 400 },
            };
          }
          const cart = store.carts.get(path.cartID);
          if (cart) {
            cart.deleted = true;
          }
          return { data: undefined };
        }),
      checkoutApi: async ({ client, path, body }: any) => {
        const sent = await accountTokenSentBy(client);
        return after(() => {
          if (store.checkoutRejection) {
            const { status, detail } = store.checkoutRejection;
            return {
              error: { errors: [{ status, title: "Checkout failed", detail }] },
              response: { status },
            };
          }
          if (sent !== undefined && !store.accountTokens.has(sent)) {
            return {
              error: {
                errors: [
                  {
                    status: 403,
                    code: "gateway.token.malformed",
                    detail: "The Account Management Authentication Token is not valid",
                  },
                ],
              },
              response: { status: 403 },
            };
          }
          const data: CheckoutBody = body?.data ?? {};
          const bodyErrors = checkoutBodyErrors(data);
          if (bodyErrors.length) {
            return {
              error: { errors: bodyErrors.map((detail) => ({ status: 400, detail })) },
              response: { status: 400 },
            };
          }
          const cart = store.cart(path.cartID);
          const order: FakeOrder = {
            id: store.nextId("order"),
            cartId: path.cartID,
            status: "incomplete",
            payment: "unpaid",
            total: cartTotal(cart),
            paid: 0,
            paymentIntentId: cart.paymentIntentId,
            transactions: [],
            lines: cart.lines.map((l) => ({
              sku: l.sku,
              quantity: l.quantity,
              amount: l.unit_price.amount * l.quantity,
              ...(l.product_id ? { productId: l.product_id } : {}),
            })),
            cartItems: cart.lines.map((l) => ({
              cartItemId: l.id,
              sku: l.sku,
              quantity: l.quantity,
              ...(l.product_id ? { productId: l.product_id } : {}),
            })),
            ...(data.customer ? { customer: data.customer } : {}),
            ...(data.contact ? { contact: data.contact } : {}),
            ...(data.account?.id ? { account: data.account.id } : {}),
            ...(data.account?.member_id ? { accountMember: data.account.member_id } : {}),
            ...(sent !== undefined ? { accountTokenSent: sent } : {}),
            fields: {},
          };
          store.orders.push(order);
          return { data: { data: store.orderResource(order) } };
        });
      },
      getAnOrder: ({ path }: any) =>
        after(() => {
          const order = store.orders.find((o) => o.id === path.orderID);
          return order
            ? { data: { data: store.orderResource(order) } }
            : { data: undefined };
        }),
      paymentSetup: ({ path }: any) =>
        after(() => {
          const order = store.orders.find((o) => o.id === path.orderID)!;
          order.payment = "paid";
          order.status = "complete";
          return {
            data: {
              data: {
                id: store.nextId("txn"),
                status: "complete",
                transaction_type: "purchase",
              },
            },
          };
        }),
      confirmOrder: ({ path }: any) => after(() => store.confirm(path.orderID)),
      getOrderTransactions: ({ path }: any) =>
        after(() => {
          const order = store.orders.find((o) => o.id === path.orderID);
          return order
            ? {
                data: {
                  data: order.transactions.map((t) => ({
                    id: t.id,
                    type: "transaction",
                    status: t.status,
                    transaction_type: "purchase",
                    reference: t.piId,
                  })),
                },
              }
            : { error: { errors: [{ status: 404 }] }, response: { status: 404 } };
        }),
      cancelATransaction: ({ path }: any) =>
        after(() => {
          if (store.cancelFails) {
            return { error: { errors: [{ status: 500, detail: "unavailable" }] }, response: { status: 500 } };
          }
          store.beforeCancel?.();
          const order = store.orders.find((o) => o.id === path.orderID);
          const tx = order?.transactions.find((t) => t.id === path.transactionID);
          if (!order || !tx) return { error: { errors: [{ status: 404 }] }, response: { status: 404 } };
          const pi = store.paymentIntents.get(tx.piId)!;
          if (pi.status === "succeeded") {
            return {
              error: {
                errors: [
                  {
                    status: 400,
                    detail: "This PaymentIntent has already succeeded after being previously confirmed.",
                  },
                ],
              },
              response: { status: 400 },
            };
          }
          pi.status = "canceled";
          tx.status = "cancelled";
          return { data: { data: { id: tx.id, type: "transaction", status: "cancelled" } } };
        }),
      getOrderItems: ({ path }: any) =>
        after(() => {
          const order = store.orders.find((o) => o.id === path.orderID);
          if (!order) {
            return { error: { errors: [{ status: 404, detail: "order not found" }] } };
          }
          return {
            data: {
              data: order.cartItems.map((item, i) => ({
                id: `${order.id}-item-${i}`,
                type: "order_item",
                sku: item.sku,
                quantity: item.quantity,
                ...(item.productId ? { product_id: item.productId } : {}),
                ...(store.orderItemsWithoutCartLines
                  ? {}
                  : {
                      relationships: {
                        cart_item: { data: { type: "cart_item", id: item.cartItemId } },
                      },
                    }),
              })),
            },
          };
        }),
      getCartItems: ({ path }: any) =>
        after(() => {
          const read = store.carts.get(path.cartID);
          return read && !read.deleted
            ? { data: { data: read.lines.map((l) => ({ ...l })) } }
            : { data: { data: [] } };
        }),
      updateAnOrder: ({ path, body }: any) =>
        after(() => {
          const order = store.orders.find((o) => o.id === path.orderID);
          if (!order) return { error: { errors: [{ status: 404 }] } };
          if (body?.data?.status === "cancelled" && order.payment === "unpaid") {
            order.status = "cancelled";
          }
          if (typeof body?.data?.external_ref === "string") {
            order.externalRef = body.data.external_ref;
          }
          const { type: _type, id: _id, status: _status, external_ref: _ref, ...fields } =
            body?.data ?? {};
          Object.assign(order.fields, fields);
          return { data: { data: store.orderResource(order) } };
        }),
      deleteAllCartItems: ({ path }: any) =>
        after(() => {
          if (store.undeletableItems.has(path.cartID)) {
            return { error: { errors: [{ status: 503 }] }, response: { status: 503 } };
          }
          store.cart(path.cartID).lines = [];
          return { data: {} };
        }),
    };
  }

  /**
   * `fetch` for the Elastic Path inventory API (multi-location stock
   * transactions). Anything else is refused.
   */
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const m = url.pathname.match(/^\/v2\/inventories\/([^/]+)\/transactions$/);
    if (!m || (init?.method ?? "GET") !== "POST") {
      return new Response(JSON.stringify({ errors: [{ status: 404 }] }), { status: 404 });
    }
    const pid = decodeURIComponent(m[1]);
    if (!this.allocated.has(pid)) {
      return new Response(JSON.stringify({ errors: [{ status: 404, detail: `product ${pid} not found` }] }), { status: 404 });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const { action, quantity } = body?.data?.attributes ?? {};
    if (action !== "deallocate" || typeof quantity !== "number") {
      return new Response(JSON.stringify({ errors: [{ status: 400 }] }), { status: 400 });
    }
    this.allocated.set(pid, this.allocated.get(pid)! - quantity);
    return new Response(JSON.stringify({ data: { type: "stock-transaction" } }), { status: 201 });
  };

  /** A cart PaymentIntent that charges the cart's total at the moment it runs. */
  chargeCart(cartId: string): Promise<string> {
    return (async () => {
      await tick();
      const cart = this.cart(cartId);
      if (!cart.paymentIntentId) {
        cart.paymentIntentId = this.nextId("pi");
      }
      const amount = cartTotal(cart);
      this.paymentIntents.set(cart.paymentIntentId, {
        id: cart.paymentIntentId,
        amount,
        status: "succeeded",
      });
      this.charges.push(amount);
      await tick();
      return cart.paymentIntentId;
    })();
  }

  /**
   * A cart PaymentIntent for the cart's total that waits for a 3DS challenge.
   * Fails like Elastic Path when the cart already has one.
   */
  startChallenge(cartId: string): Promise<FakePaymentIntent> {
    return (async () => {
      await tick();
      const cart = this.cart(cartId);
      if (cart.paymentIntentId) {
        throw new Error("Payment Intent already exists for this cart");
      }
      const pi: FakePaymentIntent = {
        id: this.nextId("pi"),
        amount: cartTotal(cart),
        status: "requires_action",
      };
      cart.paymentIntentId = pi.id;
      this.paymentIntents.set(pi.id, pi);
      await tick();
      return pi;
    })();
  }

  /** The shopper passes the challenge: the PaymentIntent takes its amount. */
  passChallenge(piId: string): boolean {
    const pi = this.paymentIntents.get(piId)!;
    if (pi.status !== "requires_action") return false;
    pi.status = "succeeded";
    this.charges.push(pi.amount);
    return true;
  }

  failChallenge(piId: string): void {
    this.paymentIntents.get(piId)!.status = "requires_payment_method";
  }

  /** `POST /v2/orders/:id/confirm`, as measured on the integration store. */
  confirm(orderId: string) {
    const fail = (detail: string) => ({
      error: { errors: [{ status: 400, detail }] },
    });
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return fail("order not found");
    if (order.status === "cancelled") return fail("This order has been cancelled.");
    const pi = order.paymentIntentId
      ? this.paymentIntents.get(order.paymentIntentId)
      : undefined;
    if (!pi) return fail("This order has no Stripe Payment Intent ID.");
    order.paymentIntentId = undefined;
    for (const line of order.lines) {
      const pid = line.productId;
      if (pid && this.allocated.has(pid)) {
        this.allocated.set(pid, this.allocated.get(pid)! + line.quantity);
      }
    }
    const succeeded = pi.status === "succeeded";
    order.transactions.push({
      id: this.nextId("txn"),
      status: succeeded ? "complete" : "pending",
      piId: pi.id,
    });
    if (succeeded) {
      order.paid += pi.amount;
      order.payment = order.paid >= order.total ? "paid" : "partially_paid";
      order.status = order.payment === "paid" ? "complete" : "incomplete";
    }
    return {
      data: {
        data: {
          id: this.nextId("txn"),
          type: "transaction",
          transaction_type: "purchase",
          status: succeeded ? "complete" : "pending",
          amount: pi.amount,
          payment_intent: { id: pi.id, status: pi.status, amount: pi.amount },
        },
      },
    };
  }

  orderResource(order: FakeOrder) {
    return {
      id: order.id,
      type: "order",
      status: order.status,
      payment: order.payment,
      ...(order.paymentIntentId ? { payment_intent_id: order.paymentIntentId } : {}),
      ...(order.customer ? { customer: order.customer } : {}),
      ...(order.contact ? { contact: order.contact } : {}),
      relationships: {
        ...(order.account ? { account: { data: { type: "account", id: order.account } } } : {}),
        ...(order.accountMember
          ? { account_member: { data: { type: "account_member", id: order.accountMember } } }
          : {}),
      },
      meta: {
        display_price: { with_tax: { amount: order.total, currency: this.currency } },
      },
    };
  }

  paidOrders(): FakeOrder[] {
    return this.orders.filter((o) => o.payment === "paid");
  }

  /** Orders that took money, whether or not it covered the order. */
  chargedOrders(): FakeOrder[] {
    return this.orders.filter((o) => o.paid > 0);
  }
}
