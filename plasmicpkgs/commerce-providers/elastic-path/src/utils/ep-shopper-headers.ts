import { accountTokenHeaders } from "../auth/ep-plugin/envelope";

export const EP_MULTI_LOCATION_INVENTORY_HEADER =
  "EP-Inventories-Multi-Location";

/** Apply last: a caller must not be able to override these. */
export function epShopperHeaders(auth: {
  accountToken?: string;
}): Record<string, string> {
  return {
    [EP_MULTI_LOCATION_INVENTORY_HEADER]: "true",
    ...accountTokenHeaders(auth),
  };
}
