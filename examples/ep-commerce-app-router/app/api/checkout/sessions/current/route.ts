/**
 * GET   /api/checkout/sessions/current — read current session.
 * PATCH /api/checkout/sessions/current — update fields (customerInfo,
 *                                       addresses, selectedShippingRateId).
 */
import type { NextRequest } from "next/server";
import {
  handleGetSession,
  handleUpdateSession,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { buildCheckoutContext } from "@/lib/checkout-context";
import {
  toSessionRequest,
  toNextResponse,
} from "@/lib/session-route-adapters";

export async function GET(req: NextRequest) {
  const { ctx } = await buildCheckoutContext(req);
  const sreq = await toSessionRequest(req);
  const sres = await handleGetSession(sreq, ctx);
  return toNextResponse(sres);
}

export async function PATCH(req: NextRequest) {
  const { ctx } = await buildCheckoutContext(req);
  const sreq = await toSessionRequest(req);
  const sres = await handleUpdateSession(sreq, ctx);
  return toNextResponse(sres);
}
