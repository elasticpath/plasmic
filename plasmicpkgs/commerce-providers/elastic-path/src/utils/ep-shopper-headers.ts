import { accountTokenHeaders } from "../auth/ep-plugin/envelope";

/**
 * Tells Elastic Path to report stock across every inventory location rather
 * than the single default one. Exported for tests and for call sites that
 * cannot take a header record.
 */
export const EP_MULTI_LOCATION_INVENTORY_HEADER =
  "EP-Inventories-Multi-Location";

/**
 * The headers a shopper-facing Elastic Path call must carry, wherever it is
 * made from. Multi-location inventory so that a store reports the same
 * availability whichever route reads it, and the selected organisation's
 * credential so that pricing is the one that shopper is entitled to.
 *
 * Apply these last. A caller that can override them turns the guarantee back
 * into a default, which is the failure this replaces: the header was three
 * separate strings and one route forgot it.
 */
export function epShopperHeaders(auth: {
  accountToken?: string;
}): Record<string, string> {
  return {
    [EP_MULTI_LOCATION_INVENTORY_HEADER]: "true",
    ...accountTokenHeaders(auth),
  };
}
