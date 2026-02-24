import type { Location } from "../inventory/types";

/**
 * Extracts the slug identifier from an EP Location object.
 *
 * The SDK Location type stores the slug at `attributes.slug`.
 * Falls back to `location.id` when attributes are missing (e.g.,
 * synthetic location objects built from stock API responses before
 * they are enriched with full Location metadata).
 */
export function getLocationSlug(location: Location): string {
  return location.attributes?.slug || location.id || "";
}
