/**
 * A storefront still on the 0.8.0 npm package, as the 0.9.0 browser
 * components meet it after a hostless publish.
 *
 * Every body comes from `fixtures/storefront-0.8.0.json`: responses recorded
 * from a real 0.8.0 storefront (ids replaced). The fake only changes the
 * amounts, quantities, ids and status in them, following the 0.8.0 checkout
 * session routes:
 * - create reads the totals and the line hash from the live cart; it needs a
 *   cart (400 `VALIDATION_ERROR` without one) but takes an empty one;
 * - GET returns the stored session and never requotes;
 * - picking a rate writes the shipping line and takes the live cart total; when
 *   that write fails it keeps the rate and the old totals;
 * - pay ignores `shownTotal`; when the lines changed it answers 409
 *   `CART_MISMATCH`, stores the new hash and keeps the old totals; otherwise
 *   it charges the live cart total, empty or not.
 * The 409 body was not recorded; it is built as the 0.8.0 pay route builds it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const recorded: any = require("./fixtures/storefront-0.8.0.json");

const clone = <T,>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

const PRODUCT_LINE = recorded.cartWithShippingLine.items[0];
const SHIPPING_LINE = recorded.cartWithShippingLine.items[1];
const RATES = recorded.addressPatchedSession.data.session.availableShippingRates;
const UNIT = PRODUCT_LINE.unit_price.amount;

type Session = Record<string, any> & { cartHash: string };

export interface OldStorefrontRequest {
  method: string;
  url: string;
  body: any;
}

export interface OldStorefrontResponse {
  status: number;
  body: any;
}

export interface OldStorefrontOrder {
  charged: number;
  skus: string[];
}

function money(amount: number) {
  return {
    amount,
    currency: "USD",
    float_price: amount / 100,
    formatted: `$${(amount / 100).toFixed(2)}`,
  };
}

export class OldStorefront {
  hasCart = true;
  quantity = 1;
  shippingLine: number | null = null;
  failShippingWrites = 0;
  orders: OldStorefrontOrder[] = [];
  private session: Session | null = null;
  private sessions = 0;
  private hooks: Array<(req: OldStorefrontRequest) => void> = [];

  /** Runs once, after the next request with this method and url is answered. */
  after(method: string, url: string, fn: () => void): void {
    const hook = (req: OldStorefrontRequest) => {
      if (req.method !== method || req.url !== url) return;
      this.hooks = this.hooks.filter((h) => h !== hook);
      fn();
    };
    this.hooks.push(hook);
  }

  get charges(): number[] {
    return this.orders.map((o) => o.charged);
  }

  storedSession(): Session | null {
    return clone(this.session);
  }

  cartTotal(): number {
    return UNIT * this.quantity + (this.shippingLine ?? 0);
  }

  private lineHash(): string {
    return this.quantity > 0 ? `${PRODUCT_LINE.id}:${this.quantity}:${UNIT}` : "";
  }

  private cartBody() {
    if (!this.hasCart) return clone(recorded.noCart.body);
    const cart: any = clone(recorded.cartWithShippingLine);
    const product = clone(PRODUCT_LINE);
    product.quantity = this.quantity;
    product.value.amount = UNIT * this.quantity;
    cart.items = [
      ...(this.quantity > 0 ? [product] : []),
      ...(this.shippingLine === null
        ? []
        : [{ ...clone(SHIPPING_LINE), unit_price: { ...SHIPPING_LINE.unit_price, amount: this.shippingLine }, value: { ...SHIPPING_LINE.value, amount: this.shippingLine } }]),
    ];
    const total = money(this.cartTotal());
    const dp = cart.meta.display_price;
    dp.with_tax = total;
    dp.without_tax = total;
    dp.without_discount = { amount: total.amount, currency: "USD", formatted: total.formatted };
    cart.itemCount = this.quantity + (this.shippingLine === null ? 0 : 1);
    return cart;
  }

  private client(session: Session) {
    const { cartHash: _hash, ...rest } = session;
    return clone(rest);
  }

  private sessionBody(session: Session) {
    return { success: true, data: { session: this.client(session) } };
  }

  private failure(status: number, code: string, message: string, extra?: object) {
    return { status, body: { success: false, error: { message, code }, ...extra } };
  }

  async route(req: OldStorefrontRequest): Promise<OldStorefrontResponse> {
    const res = this.answer(req);
    for (const hook of [...this.hooks]) hook(req);
    return res;
  }

  private answer({ method, url, body }: OldStorefrontRequest): OldStorefrontResponse {
    switch (`${method} ${url}`) {
      case "POST /api/ep/proxy/getCart":
        return { status: 200, body: this.cartBody() };
      case "POST /api/ep/proxy/applyPromoCode":
        return clone(recorded.promoUnknownFn);
      case "POST /api/checkout/sessions":
        return this.create();
      case "GET /api/checkout/sessions/current":
        return {
          status: 200,
          body: this.session ? this.sessionBody(this.session) : { success: true, data: { session: null } },
        };
      case "PATCH /api/checkout/sessions/current":
        return this.update(body ?? {});
      case "POST /api/checkout/sessions/current/shipping":
        if (!this.session) return this.failure(410, "SESSION_GONE", "Session not found or has expired");
        this.session.availableShippingRates = clone(RATES);
        return { status: 200, body: this.sessionBody(this.session) };
      case "POST /api/checkout/sessions/current/pay":
        return this.pay();
      default:
        return { status: 404, body: { error: `no route ${method} ${url}` } };
    }
  }

  private create(): OldStorefrontResponse {
    if (!this.hasCart) return clone(recorded.createWithoutCart);
    const template =
      this.quantity > 0 ? recorded.createdSession : recorded.emptyCartSession;
    const session: Session = {
      ...clone(template.data.session),
      id: `00000000-0000-4000-9000-${String(++this.sessions).padStart(12, "0")}`,
      cartHash: this.lineHash(),
      totals: {
        subtotal: this.cartTotal(),
        tax: 0,
        shipping: 0,
        total: this.cartTotal(),
        currency: "USD",
      },
    };
    this.session = session;
    return { status: 201, body: this.sessionBody(session) };
  }

  private update(update: Record<string, any>): OldStorefrontResponse {
    const session = this.session;
    if (!session) return this.failure(410, "SESSION_GONE", "Session not found or has expired");
    if (session.status !== "open") return this.failure(400, "SESSION_NOT_OPEN", "Session is not open");
    for (const key of ["customerInfo", "billingAddress", "requiresShipping"]) {
      if (update[key] !== undefined) session[key] = clone(update[key]);
    }
    const addressChanged =
      update.shippingAddress !== undefined &&
      JSON.stringify(update.shippingAddress) !== JSON.stringify(session.shippingAddress);
    if (update.shippingAddress !== undefined) session.shippingAddress = clone(update.shippingAddress);
    if (addressChanged) {
      session.availableShippingRates = clone(RATES);
      session.selectedShippingRateId = null;
      session.totals = { ...session.totals, shipping: 0, total: session.totals.subtotal + session.totals.tax };
    } else if (update.selectedShippingRateId !== undefined) {
      session.selectedShippingRateId = update.selectedShippingRateId;
      const rate = session.availableShippingRates.find(
        (r: { id: string }) => r.id === update.selectedShippingRateId
      );
      if (rate && this.failShippingWrites > 0) {
        this.failShippingWrites--;
      } else if (rate) {
        this.shippingLine = rate.amount;
        session.totals = { ...session.totals, shipping: rate.amount, total: this.cartTotal() };
      }
    }
    return { status: 200, body: this.sessionBody(session) };
  }

  private pay(): OldStorefrontResponse {
    const session = this.session;
    if (!session) return this.failure(410, "SESSION_GONE", "Session not found or has expired");
    if (session.status !== "open") return this.failure(400, "SESSION_NOT_OPEN", "Session is not open");
    const fresh = this.lineHash();
    if (fresh !== session.cartHash) {
      session.cartHash = fresh;
      return this.failure(409, "CART_MISMATCH", "Cart has changed since session was created", {
        data: { session: this.client(session) },
      });
    }
    const missing: string[] = [];
    if (!session.customerInfo) missing.push("customerInfo");
    if (!session.billingAddress) missing.push("billingAddress");
    if (session.requiresShipping !== false && !session.shippingAddress) missing.push("shippingAddress");
    if (session.requiresShipping !== false && !session.selectedShippingRateId) {
      missing.push("selectedShippingRateId");
    }
    if (missing.length > 0) {
      return this.failure(400, "MISSING_FIELDS", `Missing required fields: ${missing.join(", ")}`);
    }
    const rate = RATES.find((r: { id: string }) => r.id === session.selectedShippingRateId);
    this.shippingLine = session.requiresShipping === false ? null : rate!.amount;
    this.orders.push({
      charged: this.cartTotal(),
      skus: [
        ...(this.quantity > 0 ? [PRODUCT_LINE.sku] : []),
        ...(this.shippingLine === null ? [] : [SHIPPING_LINE.sku]),
      ],
    });
    const paid = clone(recorded.paidSession.data.session);
    Object.assign(session, {
      status: "complete",
      payment: paid.payment,
      order: { id: `order-${this.orders.length}` },
    });
    this.quantity = 0;
    this.shippingLine = null;
    return { status: 200, body: this.sessionBody(session) };
  }
}
