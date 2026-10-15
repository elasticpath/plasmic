import { getAnOrder } from "@epcc-sdk/sdks-shopper";
import type { Client } from "@epcc-sdk/sdks-shopper";

export interface OrderTotal {
  amount: number;
  currency?: string;
}

type OrderLike = {
  meta?: {
    display_price?: { with_tax?: { amount?: unknown; currency?: unknown } };
  };
};

function totalOf(order: OrderLike | undefined): OrderTotal | null {
  const withTax = order?.meta?.display_price?.with_tax;
  if (typeof withTax?.amount !== "number") return null;
  return {
    amount: withTax.amount,
    currency: typeof withTax.currency === "string" ? withTax.currency : undefined,
  };
}

/**
 * The order's tax-inclusive total. When the given order carries none, the
 * order is read back once; `null` means Elastic Path reported no total.
 */
export async function readOrderTotal(
  client: Client,
  orderId: string,
  order: OrderLike
): Promise<OrderTotal | null> {
  const own = totalOf(order);
  if (own) return own;
  try {
    const res = await getAnOrder({ client, path: { orderID: orderId } });
    return totalOf((res as { data?: { data?: OrderLike } })?.data?.data);
  } catch {
    return null;
  }
}
