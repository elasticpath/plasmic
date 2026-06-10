/**
 * Order custom fields — writes a checkout's extra fields + consent flags onto
 * the *order* (not just the cart).
 *
 * Why this exists: EP's `checkoutApi` does not copy a cart's `custom_attributes`
 * onto the resulting order, and the order resource rejects writes to the
 * free-form `custom_attributes` bag entirely. EP's supported mechanism for
 * structured order-level data is **Flows**: define fields on a core flow with
 * `slug: "orders"`, and those field slugs become first-class attributes that
 * can be set directly under `data` on `PUT /v2/orders/{orderID}` and read back
 * on the order. This module forwards the checkout's extras to those fields.
 *
 * Unlike cart custom_attributes (which use a typed `{ type, value }` envelope),
 * order flow fields take **raw values** as top-level keys under `data`.
 *
 * Auth: updating an order requires the **client_credentials** grant. The token
 * is sent as an explicit `Authorization: Bearer` header (NOT via an SDK client's
 * auth layer), because that layer re-resolves the token through its
 * implicit-grant provider — the request would then carry an *implicit* token and
 * EP rejects it with `403 gateway.scopes.authorise`. (Same gotcha as
 * `createCartPaymentIntent`.)
 *
 * Generic by design: the consumer's `orders` flow defines which slugs exist;
 * slugs the flow hasn't defined are silently dropped by EP (a mixed
 * defined/undefined payload still succeeds and persists the defined ones), so
 * the whole extras map can be forwarded as-is without the package knowing the
 * store's schema.
 */
import { updateAnOrder } from "@epcc-sdk/sdks-shopper";
import { createLogger } from "../../utils/logger";

const log = createLogger("OrderCustomFields");

/**
 * Flattens a flat extras map into the raw key/value shape EP expects for
 * order flow fields. Empty strings and nullish values are dropped (they carry
 * no signal); booleans and numbers pass through unchanged. Returns `undefined`
 * when nothing remains. Exported for unit testing.
 */
export function toOrderCustomFields(
  input?: Record<string, string | number | boolean>
): Record<string, string | number | boolean> | undefined {
  if (!input) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface PersistOrderCustomFieldsOptions {
  /** EP API base URL (e.g. the session context's `apiBaseUrl`). */
  host: string;
  /** A client_credentials token (carries the grant to update an order). */
  token: string;
  orderId: string;
  input?: Record<string, string | number | boolean>;
}

/**
 * Best-effort write of the checkout extras/consents onto the order as flow
 * fields. Failures are swallowed: the order is already placed (and, on the
 * paid path, already charged), so a missing extras write must never fail the
 * checkout — it is recorded as a warning instead. EP returns a soft error
 * (no throw) on a bad request, so the result `error` is checked explicitly.
 */
export async function persistOrderCustomFields(
  opts: PersistOrderCustomFieldsOptions
): Promise<void> {
  const fields = toOrderCustomFields(opts.input);
  if (!fields) return;
  try {
    const res = await updateAnOrder({
      baseUrl: opts.host,
      headers: { Authorization: `Bearer ${opts.token}` },
      path: { orderID: opts.orderId },
      body: { data: { type: "order", id: opts.orderId, ...fields } } as never,
    });
    const err = (res as { error?: unknown }).error;
    if (err) {
      log.warn("Order custom fields write returned an error", {
        orderId: opts.orderId,
        error: JSON.stringify(err).slice(0, 300),
      } as Record<string, unknown>);
    }
  } catch (err) {
    log.warn("Failed to persist order custom fields", {
      orderId: opts.orderId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
  }
}
