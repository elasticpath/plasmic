/**
 * POST /api/checkout/sessions/current/resume-payment — post-3DS Stripe resume.
 *
 * After /pay returned requires_action, the client completes handleNextAction
 * then POSTs here. Server: cart-hash check → checkoutApi (or reuse
 * session.order) → confirmOrder with the stored paymentIntentId → on
 * success, cart cleanup and complete. Does not create a PaymentIntent.
 */
import type { NextRequest } from "next/server";
import { handleResumePayment } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { buildCheckoutContext } from "@/lib/checkout-context";
import {
  toSessionRequest,
  toNextResponse,
} from "@/lib/session-route-adapters";

export async function POST(req: NextRequest) {
  const { ctx } = await buildCheckoutContext(req);
  const sreq = await toSessionRequest(req);
  const sres = await handleResumePayment(sreq, ctx);
  return toNextResponse(sres);
}
