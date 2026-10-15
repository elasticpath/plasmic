/**
 * Manual OrderFirstAdapter — EPCC `manual` gateway.
 *
 * /pay owns checkoutApi + paymentSetup. This adapter only returns the
 * PaymentSetupRequest body. Host configures purchase vs authorize at
 * registration; capture is not implemented here.
 */
import type { OrderFirstAdapter, PaymentSetupRequest } from "../types";
import {
  manualPaymentAllowed,
  type ManualPaymentRule,
} from "../manual-payment-rule";

export const MANUAL_GATEWAY = "manual";
export const MANUAL_PURCHASE_METHOD = "purchase";

export type ManualPaymentMethod = "purchase" | "authorize";

export interface ManualAdapterConfig {
  /** EPCC Manual paymentSetup method. Defaults to purchase. */
  method?: ManualPaymentMethod;
  /** See {@link ManualPaymentRule}. */
  allow?: ManualPaymentRule;
}

export function createManualAdapter(
  config: ManualAdapterConfig = {}
): OrderFirstAdapter {
  const method = config.method ?? MANUAL_PURCHASE_METHOD;
  return {
    paymentSequence: "order_first",
    allowsOrder: (input) => manualPaymentAllowed(config.allow, input),
    buildPaymentSetup(): PaymentSetupRequest {
      return {
        gateway: MANUAL_GATEWAY,
        method,
      };
    },
  };
}
