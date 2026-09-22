/**
 * POST /api/checkout/sessions/current/abandon-payment — unlink the cart PI
 * after a failed/cancelled Stripe 3DS challenge.
 *
 * Body: {}
 *
 * Server: session must be open + payment.status requires_action + stripe.
 * Then PUT /v2/carts/{cartID} with `{ data: { payment_intent_id: "" } }`
 * and reset session clientToken / actionData / paymentIntentId so the next
 * /pay can create a new PaymentIntent. Does not create a PI or resume.
 */
import type { NextRequest } from "next/server";
import { handleAbandonPayment } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { buildCheckoutContext } from "@/lib/checkout-context";
import {
  toSessionRequest,
  toNextResponse,
} from "@/lib/session-route-adapters";

export async function POST(req: NextRequest) {
  const { ctx } = await buildCheckoutContext(req);
  const sreq = await toSessionRequest(req);
  const sres = await handleAbandonPayment(sreq, ctx);
  return toNextResponse(sres);
}
