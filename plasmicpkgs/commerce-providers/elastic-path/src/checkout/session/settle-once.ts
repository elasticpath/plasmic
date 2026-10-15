import type { SessionResponse } from "./types";

// Held in this process only: a pay for the same cart on another server
// instance is not seen here.
const settling = new Map<
  string,
  { sessionId: string; result: Promise<SessionResponse> }
>();

/**
 * Runs `pay` for a cart unless a pay for that cart is already running. The
 * same checkout session shares the running pay's response; another checkout
 * session gets `"busy"`.
 */
export function settleOnce(
  cartId: string,
  sessionId: string,
  pay: () => Promise<SessionResponse>
): Promise<SessionResponse> | "busy" {
  const running = settling.get(cartId);
  if (running) {
    return running.sessionId === sessionId ? running.result : "busy";
  }
  const result = Promise.resolve()
    .then(pay)
    .finally(() => settling.delete(cartId));
  settling.set(cartId, { sessionId, result });
  return result;
}

/** True while a pay for the cart is running in this process. */
export function isSettling(cartId: string): boolean {
  return settling.has(cartId);
}
