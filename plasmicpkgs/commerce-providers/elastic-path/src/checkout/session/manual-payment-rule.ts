import type { EpCartResponse, PaymentAdapterOrderRuleInput } from "./types";

export type { EpCartResponse };

/** What a host's Manual payment rule sees about the order it decides on. */
export type ManualPaymentRuleInput = PaymentAdapterOrderRuleInput;

/**
 * Decides whether an order with a total above zero may use the `manual`
 * gateway, for example invoice terms for approved accounts. Only `true`
 * allows it; a rule that throws refuses. Without a rule, `manual` takes only
 * orders whose total is zero. The rule runs before the order is created.
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
