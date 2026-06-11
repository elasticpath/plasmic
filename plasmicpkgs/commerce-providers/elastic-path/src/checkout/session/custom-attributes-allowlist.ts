/**
 * Allow-list enforcement for client-supplied checkout custom attributes.
 *
 * `customAttributes` are the non-reserved extra fields + consent flags a
 * checkout form collects. They are written to the cart's `custom_attributes`
 * and forwarded to the order's flow fields. EP persists any slug its flow
 * defines, so without a gate a client could set ANY defined order-flow slug —
 * including consent/audit/system fields the form never exposes — simply by
 * sending it through `updateSession`. This module is the server-side gate:
 * only keys the consumer explicitly allow-lists survive.
 *
 * Fail closed: with no allow-list configured, NO custom attributes are
 * accepted. A consumer that intends to accept arbitrary keys must opt in
 * explicitly with the `"*"` sentinel — so permissive behaviour is a
 * deliberate, greppable choice, never an accident.
 *
 * Enforced at two layers: the `updateSession` boundary (reject forged keys on
 * entry, keep the session clean) and defensively in the `/pay` handler right
 * before the privileged admin-token writes (the trust boundary for what
 * actually reaches EP). A single helper keeps the two in lockstep.
 */
import type { CustomAttributeAllowList } from "./types";

export interface FilteredCustomAttributes {
  /** Keys that passed the allow-list. `undefined` when nothing remains. */
  allowed: Record<string, string | number | boolean> | undefined;
  /**
   * Keys that were rejected — surfaced so the caller can log a keys-only
   * warning. NEVER log the dropped values (they may be PII).
   */
  dropped: string[];
}

/**
 * Filter a customAttributes map down to the keys the allow-list permits.
 *
 * - empty / absent input → nothing to do
 * - `"*"` → pass everything through (explicit opt-out)
 * - a list → keep listed keys, report the rest as dropped
 * - `undefined` list → fail closed (drop everything, report all as dropped)
 */
export function filterAllowedCustomAttributes(
  attrs: Record<string, string | number | boolean> | undefined,
  allowList: CustomAttributeAllowList | undefined
): FilteredCustomAttributes {
  if (!attrs || Object.keys(attrs).length === 0) {
    return { allowed: undefined, dropped: [] };
  }
  if (allowList === "*") {
    return { allowed: attrs, dropped: [] };
  }

  const permitted = new Set(allowList ?? []);
  const allowed: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (permitted.has(key)) {
      allowed[key] = value;
    } else {
      dropped.push(key);
    }
  }

  return {
    allowed: Object.keys(allowed).length > 0 ? allowed : undefined,
    dropped,
  };
}
