/**
 * The checkout's shipping line is in the cart only while a payment runs.
 *
 * Elastic Path prices the line with the cart (promotions, tax), so the
 * checkout total is read with the line in the cart, and the line is then taken
 * out. Outside a payment, the cart's totals are what its lines cost, for every
 * reader: the cart page, the mini-cart, and components older than this
 * storefront that read `meta` and list every line.
 *
 * `/pay` writes the line again before it charges (ADR-0013). The line stays
 * after the payment only while a card check waits with no order held, because
 * the order is then made from the cart.
 */
import type { Client } from "@epcc-sdk/sdks-shopper";
import { createLogger } from "../../utils/logger";
import { buildAdminEpClient } from "./admin-client";
import { applyShippingSelection } from "./apply-shipping-selection";
import { resolveShippingRate } from "./cart-shipping";
import { cartLines, totalsFromCart, totalsWithoutShipping } from "./session-totals";
import { clearCartShippingLine } from "./set-shipping-line";
import { isShippingLine } from "./shipping-line-sku";
import type {
  CheckoutSession,
  EpCartResponse,
  SessionHandlerContext,
  SessionResponse,
  SessionShippingRate,
  SessionTotals,
} from "./types";

const log = createLogger("ShippingLineScope");

const PRICE_ATTEMPTS = 2;

interface PricedLine {
  quantity?: unknown;
  unit_price?: { amount?: unknown };
}

/** The read holds exactly the line for `rate`: a concurrent price took none out. */
function pricedWith(cart: EpCartResponse, rate: SessionShippingRate): boolean {
  const lines = cartLines(cart).filter(isShippingLine) as PricedLine[];
  return (
    lines.length === 1 &&
    lines[0].quantity === 1 &&
    lines[0].unit_price?.amount === rate.amount
  );
}

/** Takes the shipping line out of the cart. Never throws. */
export async function releaseShippingLine(
  client: Client,
  cartId: string
): Promise<void> {
  try {
    await clearCartShippingLine(client, { cartId });
  } catch (err) {
    log.warn("Could not take the shipping line out of the cart", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The cart priced with the session's chosen rate, read with the line in the
 * cart; the line is taken out before this returns. Throws
 * `ShippingResolutionError` for a rate the session was not offered, and an
 * error when Elastic Path could not price it.
 */
export async function priceShippingSelection(
  ctx: SessionHandlerContext,
  session: CheckoutSession,
  client?: Client
): Promise<EpCartResponse> {
  const admin = client ?? (await buildAdminEpClient(ctx));
  try {
    for (let attempt = 0; attempt < PRICE_ATTEMPTS; attempt++) {
      const priced = await applyShippingSelection(ctx, session, { client: admin });
      const rate = resolveShippingRate(
        session.availableShippingRates,
        session.selectedShippingRateId ?? ""
      );
      if (pricedWith(priced, rate)) return priced;
    }
    throw new Error("The shipping line changed while the cart was priced");
  } finally {
    await releaseShippingLine(admin, session.cartId);
  }
}

/**
 * Totals for the session's cart: with the chosen rate priced in, or without
 * shipping when no rate is chosen or the rate cannot be priced now. In that
 * last case the rate is dropped, so the page asks for it again.
 */
export async function quoteSessionTotals(
  ctx: SessionHandlerContext,
  session: CheckoutSession,
  cartResponse: unknown
): Promise<Pick<CheckoutSession, "totals" | "selectedShippingRateId">> {
  const withoutShipping = (): SessionTotals | null =>
    totalsWithoutShipping(totalsFromCart(cartResponse));
  if (!session.selectedShippingRateId) {
    return { totals: withoutShipping(), selectedShippingRateId: null };
  }
  try {
    const priced = await priceShippingSelection(ctx, session);
    const totals = totalsFromCart(priced);
    if (totals) {
      return { totals, selectedShippingRateId: session.selectedShippingRateId };
    }
  } catch (err) {
    log.warn("Could not price the chosen rate; the shopper chooses again", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { totals: withoutShipping(), selectedShippingRateId: null };
}

/** A card check waits and no order is held: the order is made from the cart. */
function ordersFromCartLater(response: SessionResponse): boolean {
  const session = (response.body as { data?: { session?: Partial<CheckoutSession> } })
    ?.data?.session;
  return session?.payment?.status === "requires_action" && !session.order?.id;
}

/**
 * Runs a payment step, then takes the shipping line out of the cart unless
 * the step left an order to be made from the cart later.
 */
export async function releasingShippingLine(
  ctx: SessionHandlerContext,
  cartId: string,
  step: () => Promise<SessionResponse>
): Promise<SessionResponse> {
  const response = await step();
  if (ordersFromCartLater(response)) return response;
  let client: Client;
  try {
    client = await buildAdminEpClient(ctx);
  } catch (err) {
    log.warn("Could not take the shipping line out of the cart", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    });
    return response;
  }
  await releaseShippingLine(client, cartId);
  return response;
}
