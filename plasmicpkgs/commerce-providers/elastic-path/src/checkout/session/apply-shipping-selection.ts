/**
 * `applyShippingSelection` — the authoritative shipping write as a
 * checkout-session step (NOT a registered `ep.*` shopper-proxy function).
 *
 * It composes the three earlier pieces of the authoritative-mutation template
 * (ADR-0013):
 *   1. `resolveShippingRate` — validate the client's *selection* (`rateId`)
 *      against the SERVER-computed `availableShippingRates`, returning the
 *      trusted, server-owned amount (or throwing).
 *   2. the credentialed admin client — the write is gated by the
 *      `client_credentials` secret, so it is server-only by construction.
 *   3. `setCartShippingLine` — the idempotent deep-module write of the
 *      *resolved* amount into the cart.
 *
 * It runs in the two places that already hold both the admin token and the
 * session's `availableShippingRates`:
 *   (a) the public `updateSession` handler, when the shopper picks a rate id
 *       (no amount) — so the cart shows the cost before pay; and
 *   (b) `handlePay`, as the re-assertion that makes the charge unforgeable.
 *
 * The client never supplies the amount: it is always sourced from the resolved
 * (server-computed) rate. A `rateId` not in `availableShippingRates` cannot
 * resolve to a price, so a forged/un-offered selection fails closed.
 */
import type { Cart } from "../../types/cart";
import { resolveShippingRate } from "./cart-shipping";
import { setCartShippingLine } from "./set-shipping-line";
import { buildAdminEpClient } from "./admin-client";
import type { CheckoutSession, SessionHandlerContext } from "./types";

/**
 * Thrown when the session's `selectedShippingRateId` cannot be resolved against
 * its server-computed `availableShippingRates` (a forged/un-offered id, a blank
 * id, or no rates computed). Distinct from an EP write failure so callers can
 * map it to the right status — a *selection* problem (400 / 409), not a
 * backend error (502).
 */
export class ShippingResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShippingResolutionError";
  }
}

export interface ApplyShippingSelectionOptions {
  /**
   * Pre-built admin EP client. `handlePay` already holds one, so it passes it
   * to avoid re-minting the admin token; `updateSession` omits it and the
   * helper builds one from `ctx.getClientCredentialsToken`.
   */
  client?: Parameters<typeof setCartShippingLine>[0];
  /** Locale for re-pricing the returned cart (defaults handled downstream). */
  locale?: string;
}

/**
 * Resolve `session.selectedShippingRateId` to its server-owned rate and write
 * that amount into the cart with the admin client, returning the re-priced
 * cart. Throws {@link ShippingResolutionError} when the selection is invalid
 * (before any write); propagates the underlying SDK error on a backend failure.
 */
export async function applyShippingSelection(
  ctx: SessionHandlerContext,
  session: CheckoutSession,
  opts: ApplyShippingSelectionOptions = {}
): Promise<Cart> {
  let rate;
  try {
    rate = resolveShippingRate(
      session.availableShippingRates,
      session.selectedShippingRateId ?? ""
    );
  } catch (err) {
    throw new ShippingResolutionError(
      err instanceof Error ? err.message : String(err)
    );
  }

  const client = opts.client ?? (await buildAdminEpClient(ctx));

  return setCartShippingLine(client, {
    cartId: session.cartId,
    rate,
    locale: opts.locale,
    // The currency is the server-computed rate's own currency — never client
    // input — keeping the cart re-read consistent with the resolved amount.
    currency: rate.currency,
  });
}
