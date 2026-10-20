/**
 * Cart hash — deterministic hash for detecting cart changes between session
 * creation and payment. Used by the /pay handler to prevent charging a stale
 * cart (409 on mismatch).
 *
 * Hash inputs: sorted item IDs + quantities + unit prices. Sorting by ID
 * ensures the same cart always produces the same hash regardless of item order.
 * A promotion line counts by its id and code only: Elastic Path re-prices it
 * whenever the rest of the cart changes (adding the shipping line does), and
 * the charge is checked against the shown total separately.
 */
import { createHash } from "crypto";

export interface CartItemForHash {
  id: string;
  quantity: number;
  /** Unit price, an integer in the currency's lowest denomination. */
  unit_price?: { amount?: number };
  /** Some EP responses use value.amount instead. */
  value?: { amount?: number };
  /** Line type, e.g. `cart_item`, `custom_item`, `promotion_item`. */
  type?: string;
  sku?: string;
}

export function hashCart(items: CartItemForHash[]): string {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const payload = sorted
    .map((item) => {
      if (item.type === "promotion_item") {
        return `${item.id}:promotion:${item.sku ?? ""}`;
      }
      const price =
        item.unit_price?.amount ?? item.value?.amount ?? 0;
      return `${item.id}:${item.quantity}:${price}`;
    })
    .join("|");
  return createHash("sha256").update(payload).digest("hex");
}
