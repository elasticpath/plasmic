/**
 * A-4.4: Calculate Shipping Rates
 *
 * Calls EP getShippingOptions using the session's cartId and stored shipping
 * address, transforms the response into SessionShippingRate[], persists the
 * updated session, and returns it to the client.
 */
import { getShippingOptions } from "@epcc-sdk/sdks-shopper";
import type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  CheckoutSession,
  ClientCheckoutSession,
  SessionShippingRate,
} from "../../../checkout/session/types";
import { toEPAddress } from "../../../checkout/session/address-utils";
import { createLogger } from "../../../utils/logger";

const log = createLogger("CalculateShipping");

function toClientSession(s: CheckoutSession): ClientCheckoutSession {
  const { cartHash, ...rest } = s;
  return rest;
}

export async function handleCalculateShipping(
  req: SessionRequest,
  ctx: SessionHandlerContext
): Promise<SessionResponse> {
  const ttl = ctx.sessionTtlSeconds ?? 1800;

  let session: CheckoutSession | null;
  try {
    session = await ctx.sessionStore.get("current", req);
  } catch (err) {
    log.error("Failed to read session from store", {
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 500,
      body: {
        success: false,
        error: { message: "Failed to read session", code: "STORE_ERROR" },
      },
    };
  }

  if (!session) {
    return {
      status: 410,
      body: {
        success: false,
        error: { message: "Session not found or has expired", code: "SESSION_GONE" },
      },
    };
  }

  if (!session.shippingAddress) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          message: "Session does not have a shipping address",
          code: "MISSING_SHIPPING_ADDRESS",
        },
      },
    };
  }

  const client = {
    settings: {
      application_id: ctx.epCredentials.clientId,
      host: ctx.epCredentials.apiBaseUrl,
    },
  } as any;

  const epAddress = toEPAddress(session.shippingAddress);

  let shippingRates: SessionShippingRate[] = [];
  try {
    const shippingResponse = await getShippingOptions({
      client,
      path: { cartID: session.cartId },
      body: {
        data: {
          shipping_address: {
            first_name: epAddress.first_name,
            last_name: epAddress.last_name,
            line_1: epAddress.line_1,
            line_2: epAddress.line_2 || "",
            city: epAddress.city,
            county: epAddress.county || "",
            country: epAddress.country,
            postcode: epAddress.postcode,
          },
        },
      },
    });

    const rawOptions = (shippingResponse.data as any)?.data ?? [];
    shippingRates = Array.isArray(rawOptions)
      ? rawOptions.map(
          (option: any): SessionShippingRate => ({
            id: option.id,
            name: option.name || option.description || "Shipping",
            description: option.description || undefined,
            amount: option.price?.amount ?? 0,
            currency: option.price?.currency ?? "USD",
            deliveryTime: option.delivery_time || undefined,
            serviceLevel: option.service_level || "standard",
            carrier: option.carrier || undefined,
          })
        )
      : [];
  } catch (err) {
    log.error("Failed to fetch shipping options from EP", {
      cartId: session.cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 502,
      body: {
        success: false,
        error: { message: "Failed to retrieve shipping options", code: "EP_ERROR" },
      },
    };
  }

  const updated: CheckoutSession = {
    ...session,
    availableShippingRates: shippingRates,
  };

  let setResult: { headers: Record<string, string> };
  try {
    setResult = await ctx.sessionStore.set("current", updated, ttl, req);
  } catch (err) {
    log.error("Failed to persist session after shipping calculation", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return {
      status: 500,
      body: {
        success: false,
        error: { message: "Failed to store session", code: "STORE_ERROR" },
      },
    };
  }

  log.info("Shipping rates calculated", {
    sessionId: updated.id,
    cartId: updated.cartId,
    rateCount: shippingRates.length,
  } as Record<string, unknown>);

  return {
    status: 200,
    body: {
      success: true,
      data: { session: toClientSession(updated) },
    },
    headers: setResult.headers,
  };
}
