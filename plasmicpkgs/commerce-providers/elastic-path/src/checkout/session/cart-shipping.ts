/**
 * Server-authoritative shipping requirement.
 *
 * `requiresShipping` is otherwise a client-supplied flag, and EP requires a
 * shipping address on EVERY checkout (physical and digital alike) — so the
 * checkout-body builder defaults a missing shipping address to billing. That
 * combination lets a client set `requiresShipping: false` on a cart containing
 * a PHYSICAL item and have the goods silently ship to the billing address.
 *
 * The server is the authority: it infers whether the cart actually needs
 * shipping from each line's product `commodity_type`, and the client flag may
 * only ADD a shipping requirement, never suppress one a physical cart imposes.
 */
import { getByContextAllProducts, createShopperClient } from "@epcc-sdk/sdks-shopper";
import { createLogger } from "../../utils/logger";
import type { SessionShippingRate } from "./types";

const log = createLogger("CartShipping");

/**
 * Resolve the effective shipping requirement. The client flag may only ADD a
 * requirement: a physical cart always requires shipping, and a non-physical
 * cart honours the client flag (defaulting to required when unset).
 */
export function resolveRequiresShipping(
  clientRequiresShipping: boolean | undefined,
  cartHasPhysicalItem: boolean
): boolean {
  return cartHasPhysicalItem || clientRequiresShipping !== false;
}

/**
 * Resolve a client-selected shipping `rateId` against the SERVER-computed set of
 * available rates, returning the trusted rate (carrying the server `amount`) or
 * throwing.
 *
 * This is the authoritative-mutation core for shipping (see ADR-0013): the
 * client may only *select* — it picks a rate id — while the SERVER owns the
 * amount. `availableRates` MUST be the server-computed list produced by
 * `calculate-shipping` (via `ctx.shippingRateResolver`), never a client-supplied
 * list, so a forged or un-offered `rateId` cannot resolve to a price. The returned rate
 * is what the credentialed cart write (`setShippingLine`) and the checkout
 * re-assertion in `handlePay` both use; neither ever trusts a client amount.
 *
 * Fails closed (throws) when no rates have been computed, the id is blank, the
 * id is not in the available set, or the trusted rate is malformed. Throwing —
 * rather than returning a fallback — ensures a bad selection cannot silently
 * proceed to a charge.
 */
export function resolveShippingRate(
  availableRates: readonly SessionShippingRate[] | undefined | null,
  rateId: string
): SessionShippingRate {
  if (typeof rateId !== "string" || rateId.trim() === "") {
    throw new Error("resolveShippingRate: rateId is required");
  }
  if (!Array.isArray(availableRates) || availableRates.length === 0) {
    throw new Error(
      "resolveShippingRate: no shipping rates available — run calculate-shipping first"
    );
  }
  const rate = availableRates.find((r) => r.id === rateId);
  if (!rate) {
    throw new Error(
      `resolveShippingRate: selected rate "${rateId}" is not an available shipping rate`
    );
  }
  // The amount is server-computed (carrier quote) and therefore trusted; this
  // guard only catches a malformed trusted source, never a client value.
  if (typeof rate.amount !== "number" || !Number.isFinite(rate.amount)) {
    throw new Error(
      `resolveShippingRate: available rate "${rateId}" has a non-numeric amount`
    );
  }
  return rate;
}

export interface CartPhysicalLookup {
  /** EP API base URL. */
  host: string;
  clientId: string;
  /** Shopper token resolving the same catalog context the cart was built in. */
  shopperAccessToken?: string;
  /** The cart lines' `product_id`s. */
  productIds: string[];
}

/**
 * True when ANY of the cart's products is a physical (shippable) commodity.
 *
 * Looks each product up in the shopper catalog context and inspects its
 * `commodity_type`. Fails OPEN (returns false) on a lookup error: the primary
 * consumer is digital/shipping-less, so a transient EP outage must not block a
 * legitimate checkout — the failure is logged, and the clean-lookup path still
 * catches every real physical cart. Callers should only consult this when the
 * client tried to suppress shipping (otherwise shipping is already required).
 */
export async function cartHasPhysicalItem(
  opts: CartPhysicalLookup
): Promise<boolean> {
  const ids = Array.from(new Set(opts.productIds.filter(Boolean)));
  if (ids.length === 0) return false;

  try {
    const { client } = createShopperClient(
      { baseUrl: opts.host },
      {
        clientId: opts.clientId,
        storage: { get: () => opts.shopperAccessToken ?? "", set: () => {} },
      }
    );
    const res = await getByContextAllProducts({
      client,
      query: { filter: `in(id,${ids.join(",")})`, "page[limit]": ids.length },
    } as never);
    const products = ((res as { data?: { data?: unknown } }).data?.data ??
      []) as Array<{ attributes?: { commodity_type?: string } }>;
    if (products.some((p) => p?.attributes?.commodity_type === "physical")) {
      return true;
    }
    if (products.length < ids.length) {
      // The lookup succeeded but didn't return every requested product, so we
      // can't prove the cart is all-digital. Fail CLOSED — require shipping
      // rather than risk a physical line we couldn't classify. (Note: this is
      // a healthy-but-incomplete response; a *total* lookup failure still fails
      // open in the catch below, to keep a digital store available.)
      log.warn(
        "Shippability lookup resolved fewer products than requested; requiring shipping",
        {
          requested: ids.length,
          resolved: products.length,
        } as Record<string, unknown>
      );
      return true;
    }
    return false;
  } catch (err) {
    log.error("Shippability lookup failed — proceeding without it", {
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return false;
  }
}
