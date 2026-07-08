/**
 * RETIRED endpoint — legacy (pre-composable) checkout shipping calculation.
 *
 * This route once fetched rates via `getShippingOptions`, an EP shopper endpoint
 * that does not exist (see #374). EP has no shopper shipping-rates endpoint, so
 * shipping rates are sourced by tenant server-side logic wired into the
 * composable checkout-session flow (`ctx.shippingRateResolver`, see #371 and
 * `api/endpoints/checkout-session/calculate-shipping.ts`).
 *
 * The legacy checkout is being removed under #326; this handler is kept only so
 * an unmigrated route responds deterministically instead of importing a phantom
 * export. It always returns 410 Gone.
 */
import { createLogger } from "../../../utils/logger";
import {
  createErrorResponse,
  validateMethod,
} from "../../utils/api-helpers";

const log = createLogger("calculateShipping");

/**
 * API endpoint to calculate shipping rates for a cart (RETIRED).
 * POST /api/checkout/calculate-shipping
 */
export default async function calculateShippingHandler(req: any, res: any) {
  if (!validateMethod(req, ["POST"])) {
    return res.status(405).json(createErrorResponse("Method not allowed"));
  }

  log.warn(
    "Legacy /checkout/calculate-shipping is retired; use the checkout-session flow"
  );

  return res.status(410).json(
    createErrorResponse(
      "The legacy shipping endpoint has been retired. Use the composable checkout-session flow, which sources rates via the server-side shipping rate resolver.",
      "ENDPOINT_RETIRED"
    )
  );
}
