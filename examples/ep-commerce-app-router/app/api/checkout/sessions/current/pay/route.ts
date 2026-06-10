/**
 * POST /api/checkout/sessions/current/pay — single-shot place-order.
 *
 * Body (slice 1): { gateway: "stripe", confirmation_token: string }
 *
 * Server runs: cart-hash check → adapter.initializePayment (calls EP
 * createCartPaymentIntent with confirm:true + confirmation_token) →
 * on succeeded: checkoutApi → confirmOrder → cart cleanup → complete.
 */
import type { NextRequest } from "next/server";
import { handlePay } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { buildCheckoutContext } from "@/lib/checkout-context";
import {
  toSessionRequest,
  toNextResponse,
} from "@/lib/session-route-adapters";

export async function POST(req: NextRequest) {
  const { ctx } = await buildCheckoutContext(req);
  const sreq = await toSessionRequest(req);
  const sres = await handlePay(sreq, ctx);
  return toNextResponse(sres);
}
