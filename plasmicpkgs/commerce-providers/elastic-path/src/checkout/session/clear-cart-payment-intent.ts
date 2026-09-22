/**
 * Clear the Cart PaymentIntent association on an EP cart.
 *
 * EP Update Cart: PUT /v2/carts/{cartID} with `{ data: { payment_intent_id: "" } }`.
 * Used after failed/cancelled 3DS (abandon) and after successful cart_payment_intent
 * checkout (finalizePaidSession) so a surviving cart cannot carry a paid PI
 * into a later order. Does not cancel the Stripe PaymentIntent.
 */
import { updateACart } from "@epcc-sdk/sdks-shopper";

export type ClearCartPaymentIntentResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

function errorMessage(error: unknown): string {
  const e: any = error;
  const details = e?.errors
    ?.map((item: any) => item?.detail || item?.title)
    .filter(Boolean)
    .join("; ");
  if (details) return details;
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.message === "string") return e.message;
  if (error instanceof Error) return error.message;
  return "Failed to clear cart payment_intent_id";
}

export async function clearCartPaymentIntentId(params: {
  client: unknown;
  cartId: string;
}): Promise<ClearCartPaymentIntentResult> {
  const { client, cartId } = params;
  if (!cartId) {
    return { ok: false, errorMessage: "cartId is required" };
  }

  try {
    const updateResult = (await updateACart({
      client: client as any,
      path: { cartID: cartId },
      body: {
        data: {
          payment_intent_id: "",
        },
      },
    })) as { error?: unknown };

    if (updateResult?.error) {
      return { ok: false, errorMessage: errorMessage(updateResult.error) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, errorMessage: errorMessage(err) };
  }
}
