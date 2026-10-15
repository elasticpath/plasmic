/**
 * POST /api/checkout/sessions — create a checkout session for the shopper's
 * session cart. A cart id in the request body is ignored.
 */
import type { NextRequest } from "next/server";
import { handleCreateSession } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { buildCheckoutContext } from "@/lib/checkout-context";
import {
  toSessionRequest,
  toNextResponse,
} from "@/lib/session-route-adapters";

export async function POST(req: NextRequest) {
  const { ctx } = await buildCheckoutContext(req);
  const sres = await handleCreateSession(await toSessionRequest(req), ctx);
  return toNextResponse(sres);
}
