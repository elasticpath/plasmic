/**
 * Deep-module write primitive for the authoritative shipping line.
 *
 * `setCartShippingLine` commits a SERVER-resolved shipping rate (the output of
 * `resolveShippingRate`) into the cart as a single `custom_item` carrying the
 * server-computed amount. It is the credentialed *write* half of the
 * authoritative-mutation template (see ADR-0013): the amount it writes never
 * comes from the client — it comes from the resolved rate, which the server
 * computed via `ctx.shippingRateResolver`.
 *
 * Idempotent: a cart ends with ONE shipping line at quantity 1. A line that
 * already matches the rate is left alone. Otherwise the line is replaced
 * (clear-then-write) and then checked: Elastic Path merges two adds of the
 * same SKU into one line, so a concurrent write is folded back to quantity 1
 * and any extra line is removed. Lines are marked with a sentinel SKU so these
 * steps never touch a catalog line.
 *
 * Pure over an injected EP client (mockable). The caller supplies the client —
 * for authoritative shipping that is the `client_credentials` admin client, so
 * the write is server-only; the primitive itself is auth-agnostic.
 */
import {
  deleteACartItem,
  getACart,
  manageCarts,
  updateACartItem,
} from "@epcc-sdk/sdks-shopper";
import { readCartResponse } from "../../ep-server-functions/read-cart";
import { EP_SHIPPING_LINE_SKU, isShippingLine } from "./shipping-line-sku";
import { cartLines } from "./session-totals";
import type { EpCartResponse, SessionShippingRate } from "./types";

export { EP_SHIPPING_LINE_SKU };

type EpClient = Parameters<typeof manageCarts>[0]["client"];

export interface ClearCartShippingLineInput {
  /** Cart whose managed shipping line(s) should be removed. */
  cartId: string;
}

export interface ClearCartShippingLineResult {
  deletedCount: number;
}

export interface SetCartShippingLineInput {
  /** Cart to write the shipping line into. */
  cartId: string;
  /** Server-resolved rate (from `resolveShippingRate`) — the trusted amount. */
  rate: SessionShippingRate;
  /** Locale for re-pricing the returned cart. Defaults to "en-US". */
  locale?: string;
  /** ISO 4217 currency for the cart re-read (X-Moltin-Currency). */
  currency?: string;
}

interface ShippingLine {
  id?: string;
  sku?: unknown;
  name?: unknown;
  quantity?: unknown;
  unit_price?: { amount?: unknown };
  custom_inputs?: { rateId?: unknown };
}

async function readShippingLines(
  client: EpClient,
  cartId: string
): Promise<ShippingLine[]> {
  const current = await getACart({
    client,
    path: { cartID: cartId },
    query: { include: ["items"] },
  });
  return cartLines(current.data).filter(isShippingLine) as ShippingLine[];
}

function chargesRate(line: ShippingLine, rate: SessionShippingRate): boolean {
  const rateId = line.custom_inputs?.rateId;
  return (
    line.unit_price?.amount === rate.amount &&
    line.name === (rate.name || "Shipping") &&
    (rateId === undefined || rateId === rate.id)
  );
}

/**
 * Leaves one line for `rate` at quantity 1, undoing a concurrent add. `added`
 * is the add response, which lists the cart's lines after the add.
 */
async function foldToOneLine(
  client: EpClient,
  cartId: string,
  rate: SessionShippingRate,
  added: unknown
): Promise<void> {
  const after = (added as { data?: { data?: unknown } })?.data?.data;
  if (!Array.isArray(after)) {
    return;
  }
  const lines: ShippingLine[] = after.filter(isShippingLine);
  const keep = lines.find((l) => chargesRate(l, rate)) ?? lines[0];
  for (const line of lines) {
    if (line !== keep && line.id) {
      await deleteACartItem({
        client,
        path: { cartID: cartId, cartitemID: line.id },
      });
    }
  }
  if (keep?.id && keep.quantity !== 1) {
    await updateACartItem({
      client,
      path: { cartID: cartId, cartitemID: keep.id },
      body: { data: { id: keep.id, quantity: 1 } },
    });
  }
}

/**
 * Remove every storefront-managed shipping line (`sku === EP_SHIPPING_LINE_SKU`)
 * from the cart. Returns how many lines were deleted so callers can skip a
 * post-clear total refresh when the cart was unchanged.
 */
export async function clearCartShippingLine(
  client: EpClient,
  input: ClearCartShippingLineInput
): Promise<ClearCartShippingLineResult> {
  const { cartId } = input;

  if (!cartId) {
    throw new Error("clearCartShippingLine: cartId is required");
  }

  const staleIds = (await readShippingLines(client, cartId))
    .map((it) => it.id)
    .filter((id): id is string => Boolean(id));
  for (const cartitemID of staleIds) {
    await deleteACartItem({ client, path: { cartID: cartId, cartitemID } });
  }
  return { deletedCount: staleIds.length };
}

/**
 * Replace the cart's shipping line with one for `rate`, returning the re-priced
 * cart in Elastic Path's own shape, shipping line included. Throws (before any write) on a missing cart or a malformed
 * rate, and propagates the underlying SDK error on a backend failure.
 */
export async function setCartShippingLine(
  client: EpClient,
  input: SetCartShippingLineInput
): Promise<EpCartResponse> {
  const { cartId, rate } = input;

  if (!cartId) {
    throw new Error("setCartShippingLine: cartId is required");
  }
  // The rate is server-resolved and trusted; this guards against a malformed
  // source, never against a client value.
  if (
    !rate ||
    typeof rate.amount !== "number" ||
    !Number.isFinite(rate.amount)
  ) {
    throw new Error(
      "setCartShippingLine: a resolved shipping rate with a numeric amount is required"
    );
  }

  const lines = await readShippingLines(client, cartId);
  const inPlace =
    lines.length === 1 &&
    lines[0].quantity === 1 &&
    chargesRate(lines[0], rate);
  if (!inPlace) {
    for (const line of lines) {
      if (line.id) {
        await deleteACartItem({
          client,
          path: { cartID: cartId, cartitemID: line.id },
        });
      }
    }
    const added = await manageCarts({
      client,
      path: { cartID: cartId },
      body: {
        data: {
          type: "custom_item",
          name: rate.name || "Shipping",
          sku: EP_SHIPPING_LINE_SKU,
          quantity: 1,
          // includes_tax: true keeps the charged shipping exactly `rate.amount`.
          price: { amount: rate.amount, includes_tax: true },
          custom_inputs: {
            kind: "shipping",
            rateId: rate.id,
            ...(rate.carrier ? { carrier: rate.carrier } : {}),
            ...(rate.serviceLevel ? { serviceLevel: rate.serviceLevel } : {}),
          },
        } as never,
      },
    });
    await foldToOneLine(client, cartId, rate, added);
  }

  return readCartResponse(client, cartId, {
    locale: input.locale,
    currency: input.currency,
  });
}
