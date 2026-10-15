import { paymentSetup } from "@epcc-sdk/sdks-shopper";
import type { Client } from "@epcc-sdk/sdks-shopper";
import { mapTransactionResponse } from "./payment-sequence";
import type {
  EpCartResponse,
  PaymentAdapterOrderRuleInput,
  PaymentAdapterResult,
  PaymentSetupRequest,
} from "./types";

/** Takes payment for an order. Never throws; a failure maps to `failed`. */
export async function takeOrderPayment(
  client: Client,
  orderId: string,
  setup: PaymentSetupRequest
): Promise<{ result: PaymentAdapterResult; response: unknown }> {
  let response: unknown;
  let thrown: unknown;
  try {
    response = await paymentSetup({
      client,
      path: { orderID: orderId },
      body: { data: setup } as never,
    });
  } catch (err) {
    thrown = err;
  }
  return { result: mapTransactionResponse(response, thrown), response };
}

export function orderRuleInput(
  cart: EpCartResponse,
  accountId: string | undefined
): PaymentAdapterOrderRuleInput {
  return { cart, account: accountId ? { id: accountId } : null };
}
