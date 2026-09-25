/**
 * POST /api/checkout/sessions/current/shipping — requote shipping rates on demand.
 */
import type { NextRequest } from "next/server";
import { handleCalculateShipping } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { buildCheckoutContext } from "@/lib/checkout-context";
import {
  toSessionRequest,
  toNextResponse,
} from "@/lib/session-route-adapters";

export async function POST(req: NextRequest) {
  const { ctx } = await buildCheckoutContext(req);
  const sreq = await toSessionRequest(req);
  const sres = await handleCalculateShipping(sreq, ctx);
  return toNextResponse(sres);
}
