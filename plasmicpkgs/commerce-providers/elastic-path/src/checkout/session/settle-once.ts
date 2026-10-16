import type { CheckoutSession, SessionResponse } from "./types";

// Held in this process only: a settlement for the same cart on another server
// instance is not seen here.
const settling = new Map<
  string,
  { sessionId: string; result: Promise<SessionResponse> }
>();

/**
 * Runs `settle` for a cart unless a settlement for that cart is already
 * running. The same checkout session shares the running settlement's
 * response; another checkout session gets `"busy"`. Every route that creates,
 * confirms or releases a payment for a cart runs through here, so a cart
 * settles one order at a time.
 */
export function settleOnce(
  cartId: string,
  sessionId: string,
  settle: () => Promise<SessionResponse>
): Promise<SessionResponse> | "busy" {
  const running = settling.get(cartId);
  if (running) {
    return running.sessionId === sessionId ? running.result : "busy";
  }
  const result = Promise.resolve()
    .then(settle)
    .finally(() => settling.delete(cartId));
  settling.set(cartId, { sessionId, result });
  return result;
}

/** `settleOnce`, answering another session's request with 409 `CHECKOUT_IN_PROGRESS`. */
export async function settleOnceOrBusy(
  session: CheckoutSession,
  settle: () => Promise<SessionResponse>
): Promise<SessionResponse> {
  const settled = settleOnce(session.cartId, session.id, settle);
  if (settled === "busy") {
    return {
      status: 409,
      body: {
        success: false,
        error: {
          message: "Another checkout for this cart is in progress",
          code: "CHECKOUT_IN_PROGRESS",
        },
      },
    };
  }
  return settled;
}

/** True while a settlement for the cart is running in this process. */
export function isSettling(cartId: string): boolean {
  return settling.has(cartId);
}
