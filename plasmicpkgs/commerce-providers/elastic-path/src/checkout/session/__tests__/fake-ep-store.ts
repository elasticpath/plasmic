/**
 * An in-memory Elastic Path store for checkout handler tests. Every call
 * yields to the event loop before and after it acts, so concurrent requests
 * interleave the way they do against the real API. Adding a custom item whose
 * SKU is already in the cart raises that line's quantity, as Elastic Path does.
 */

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
}

export interface FakeOrder {
  id: string;
  cartId: string;
  status: string;
  payment: string;
  total: number;
  lines: Array<{ sku?: string; quantity: number; amount: number }>;
}

interface FakeCart {
  lines: FakeLine[];
  deleted: boolean;
  paymentIntentId?: string;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function cartTotal(cart: FakeCart): number {
  return cart.lines.reduce(
    (sum, l) => sum + l.unit_price.amount * l.quantity,
    0
  );
}

export class FakeEpStore {
  carts = new Map<string, FakeCart>();
  orders: FakeOrder[] = [];
  /** Amounts taken by a cart PaymentIntent, one entry per charge. */
  charges: number[] = [];
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
        quantity: l.quantity,
        unit_price: { amount: l.unit_price.amount },
        value: { amount: l.unit_price.amount * l.quantity },
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
                with_tax: { amount, currency: "USD" },
                without_tax: { amount, currency: "USD" },
                tax: { amount: 0, currency: "USD" },
              },
            },
          },
          included: {
            items: cart.lines.map((l) => ({
              ...l,
              value: { amount: l.unit_price.amount * l.quantity },
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
          const cart = store.carts.get(path.cartID);
          if (cart) {
            cart.deleted = true;
          }
          return { data: undefined };
        }),
      checkoutApi: ({ path }: any) =>
        after(() => {
          const cart = store.cart(path.cartID);
          const order: FakeOrder = {
            id: store.nextId("order"),
            cartId: path.cartID,
            status: "incomplete",
            payment: "unpaid",
            total: cartTotal(cart),
            lines: cart.lines.map((l) => ({
              sku: l.sku,
              quantity: l.quantity,
              amount: l.unit_price.amount * l.quantity,
            })),
          };
          store.orders.push(order);
          return { data: { data: store.orderResource(order) } };
        }),
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
      confirmOrder: ({ path }: any) =>
        after(() => {
          const order = store.orders.find((o) => o.id === path.orderID)!;
          order.payment = "paid";
          order.status = "complete";
          return { data: { data: store.orderResource(order) } };
        }),
      updateAnOrder: () => after(() => ({ data: { data: {} } })),
      deleteAllCartItems: ({ path }: any) =>
        after(() => {
          store.cart(path.cartID).lines = [];
          return { data: {} };
        }),
    };
  }

  /** A cart PaymentIntent that charges the cart's total at the moment it runs. */
  chargeCart(cartId: string): Promise<string> {
    return (async () => {
      await tick();
      const cart = this.cart(cartId);
      if (!cart.paymentIntentId) {
        cart.paymentIntentId = this.nextId("pi");
      }
      this.charges.push(cartTotal(cart));
      await tick();
      return cart.paymentIntentId;
    })();
  }

  orderResource(order: FakeOrder) {
    return {
      id: order.id,
      type: "order",
      status: order.status,
      payment: order.payment,
      meta: {
        display_price: { with_tax: { amount: order.total, currency: "USD" } },
      },
    };
  }

  paidOrders(): FakeOrder[] {
    return this.orders.filter((o) => o.payment === "paid");
  }
}
