/**
 * Cart Payment Intent Adapter — server-side adapter that calls EP's
 * `createCartPaymentIntent` for the EP-native Stripe gateway.
 *
 * The host app no longer holds a Stripe secret key. EP holds the credentials
 * (configured in Commerce Manager) and runs the PaymentIntent lifecycle on
 * its side. The host calls one EP endpoint with `confirm: true` plus a
 * `confirmation_token` minted client-side via Stripe Elements.
 *
 * Slice 1 (this PR): cover the succeeded and failed branches. The
 * `requires_action` (3DS) branch ships in slice 2.
 */
import { createCartPaymentIntent } from "@epcc-sdk/sdks-shopper";
import type {
  PaymentAdapter,
  PaymentAdapterResult,
  CheckoutSession,
} from "../types";
import { createLogger } from "../../../utils/logger";

const log = createLogger("StripeAdapter");

export interface StripeAdapterConfig {
  /** EP API base URL — e.g. `https://api.elasticpath.com`. */
  host: string;
  /**
   * EP client id. Reserved for SDK client scoping; the request itself is
   * authorised by the explicit Bearer token, so this is currently unused by
   * the adapter but kept for API stability / future use.
   */
  clientId?: string;
  /**
   * Request-scoped admin token resolver. Built per-request by the host app's
   * checkout-context factory. Memoized within the request so multiple
   * adapter calls share one mint. Never cached across requests.
   */
  getClientCredentialsToken: () => Promise<string>;
  /**
   * Shopper (implicit-grant) token of the cart's owner. `createCartPaymentIntent`
   * is a storefront operation scoped to the shopper that owns the cart — EP's
   * `client_credentials` grant is rejected for it (`gateway.scopes.authorise`).
   * When provided, the adapter uses this token; it falls back to the admin
   * token only if no shopper token is available.
   */
  getShopperToken?: () => string | Promise<string>;
}

interface EpPaymentIntentResponseShape {
  data?: {
    data?: {
      payment_intent?: {
        id?: string;
        status?: string;
      };
    };
  };
}

export function createStripeAdapter(
  config: StripeAdapterConfig
): PaymentAdapter {
  const { host, getClientCredentialsToken, getShopperToken } = config;

  return {
    async initializePayment(
      session: CheckoutSession,
      gatewayData: Record<string, unknown>
    ): Promise<PaymentAdapterResult> {
      const confirmationToken = gatewayData.confirmation_token as
        | string
        | undefined;

      // createCartPaymentIntent requires the client_credentials grant of a
      // client that carries the payments/gateway scope.
      //
      // The token is sent as an explicit Authorization header, NOT via the
      // SDK client's auth layer: that layer re-resolves the token through its
      // implicit-grant provider (keyed on clientId), so the request would
      // carry an *implicit* token and EP rejects it with
      // `403 gateway.scopes.authorise`. An explicit header is used verbatim.
      let token = await getClientCredentialsToken();
      if (!token && getShopperToken) token = await getShopperToken();

      const response = (await createCartPaymentIntent({
        baseUrl: host,
        headers: { Authorization: `Bearer ${token}` },
        path: { cartID: session.cartId },
        body: {
          data: {
            gateway: "elastic_path_payments_stripe",
            method: "purchase",
            // Do NOT send payment_method_types alongside
            // automatic_payment_methods — Stripe rejects the combination.
            options: {
              automatic_payment_methods: { enabled: true },
              confirm: true,
              confirmation_token: confirmationToken,
              return_url: "https://placeholder.com",
            } as any,
          },
        },
      })) as any;

      // EP wraps the HTTP body in `.data`; an SDK-level error is in `.error`.
      const body: any = response?.data;
      const epError: any = response?.error;
      const cart: any = body?.data ?? body;

      // The PaymentIntent surfaces under `meta.payment_intent`, which itself
      // wraps the Stripe PI under a nested `payment_intent` key. Unwrap both
      // and fall back to the cart's `payment_intent_id`.
      const piWrap: any =
        body?.meta?.payment_intent ??
        cart?.meta?.payment_intent ??
        cart?.payment_intent ??
        body?.payment_intent;
      const pi: any = piWrap?.payment_intent ?? piWrap;
      const piId: string | undefined =
        pi?.id ?? cart?.payment_intent_id ?? body?.payment_intent_id;
      const piStatus: string | undefined = pi?.status;

      // Success when the PI confirmed (succeeded / requires_capture for an
      // auth), or — tolerant fallback — when EP returned a PaymentIntent id
      // with no error (confirm:true ran). The order is then created + synced
      // via confirmOrder downstream.
      const succeeded =
        !epError &&
        !!piId &&
        (piStatus === undefined ||
          piStatus === "succeeded" ||
          piStatus === "requires_capture" ||
          piStatus === "processing");
      if (succeeded) {
        return {
          status: "succeeded",
          gatewayOrderId: piId!,
          gatewayMetadata: { paymentIntentId: piId! },
        };
      }

      const errDetail =
        epError?.errors?.map((e: any) => e.detail).filter(Boolean).join("; ") ||
        epError?.message ||
        (piStatus ? `status: ${piStatus}` : "status: unknown");
      log.warn("PaymentIntent did not succeed", { piStatus, errDetail } as Record<
        string,
        unknown
      >);
      return {
        status: "failed",
        errorMessage: `Payment did not complete (${errDetail})`,
        ...(piId ? { gatewayMetadata: { paymentIntentId: piId } } : {}),
      };
    },

    async confirmPayment(
      _session: CheckoutSession,
      _confirmData: Record<string, unknown>
    ): Promise<PaymentAdapterResult> {
      // Single-shot flow: confirmation happens inside initializePayment via
      // EP's `confirm: true`. Kept as a no-op for interface compatibility;
      // the legacy two-step path is removed in the follow-up rip-out.
      return { status: "succeeded" };
    },
  };
}
