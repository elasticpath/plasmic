import type { getACart } from "@epcc-sdk/sdks-shopper";

export type EpCartResponse = NonNullable<
  Awaited<ReturnType<typeof getACart>>["data"]
>;

/** What a host's Manual payment rule sees about the order it decides on. */
export interface ManualPaymentRuleInput {
  /** The cart, in Elastic Path's own shape, with its items under `included`. */
  cart: EpCartResponse;
  /** The account the shopper buys for, or `null` when none is selected. */
  account: { id: string } | null;
}

/**
 * Decides whether an order with a total above zero may use the `manual`
 * gateway. Only `true` allows it. A rule that throws refuses.
 */
export type ManualPaymentRule = (
  input: ManualPaymentRuleInput
) => boolean | Promise<boolean>;

export async function manualPaymentAllowed(
  rule: ManualPaymentRule | undefined,
  input: ManualPaymentRuleInput
): Promise<boolean> {
  if (!rule) return false;
  try {
    return (await rule(input)) === true;
  } catch {
    return false;
  }
}
