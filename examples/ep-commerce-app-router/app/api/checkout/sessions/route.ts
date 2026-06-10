/**
 * POST /api/checkout/sessions — create a checkout session.
 *
 * The cartId is resolved server-side from the better-auth session
 * (epCartId field), so designers don't have to thread it through Plasmic
 * interactions.
 */
import type { NextRequest } from "next/server";
import { handleCreateSession } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { buildCheckoutContext } from "@/lib/checkout-context";
import {
  toSessionRequest,
  toNextResponse,
} from "@/lib/session-route-adapters";

export async function POST(req: NextRequest) {
  const { ctx, epCartId } = await buildCheckoutContext(req);
  const sreq = await toSessionRequest(req);
  // Inject server-resolved cartId when client didn't pass one.
  if (!sreq.body.cartId && epCartId) {
    sreq.body = { ...sreq.body, cartId: epCartId };
  }
  const sres = await handleCreateSession(sreq, ctx);
  return toNextResponse(sres);
}
