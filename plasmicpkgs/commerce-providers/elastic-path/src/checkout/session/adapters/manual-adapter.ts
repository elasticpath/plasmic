/**
 * Manual OrderFirstAdapter — EPCC `manual` gateway, purchase only.
 *
 * /pay owns checkoutApi + paymentSetup. This adapter only returns the
 * PaymentSetupRequest body. No authorize/capture in this slice.
 */
import type { OrderFirstAdapter, PaymentSetupRequest } from "../types";

export const MANUAL_GATEWAY = "manual";
export const MANUAL_PURCHASE_METHOD = "purchase";

export function createManualAdapter(): OrderFirstAdapter {
  return {
    paymentSequence: "order_first",
    buildPaymentSetup(): PaymentSetupRequest {
      return {
        gateway: MANUAL_GATEWAY,
        method: MANUAL_PURCHASE_METHOD,
      };
    },
  };
}
