/**
 * Cart Payment Intent Adapter — server-side adapter that calls EP's
 * `createCartPaymentIntent` for the EP-native Stripe gateway.
 *
 * The host app no longer holds a Stripe secret key. EP holds the credentials
 * (configured in Commerce Manager) and runs the PaymentIntent lifecycle on
 * its side. The host calls one EP endpoint with `confirm: true` plus a
 * `confirmation_token` minted client-side via Stripe Elements.
 *
 * Maps Stripe PaymentIntent status (one table: `payment-intent-status.ts`)
 * to PaymentAdapterResult:
 *   succeeded / requires_capture → succeeded
 *   requires_action (3DS) and processing → requires_action with the client
 *     secret: /pay holds the order, and resume confirms it only once the
 *     payment is taken
 *   anything else → failed
 */
import { createCartPaymentIntent } from "@epcc-sdk/sdks-shopper";
import type {
  CartPaymentIntentAdapter,
  CartPaymentIntentState,
  PaymentAdapterResult,
  PaymentIntentReadKeys,
  CheckoutSession,
} from "../types";
import { createLogger } from "../../../utils/logger";
import { paymentIntentPhase } from "../payment-intent-status";

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
  /**
   * Stripe publishable key (`pk_…`) the storefront's payment form uses.
   * With it, resume reads the PaymentIntent from Stripe, as Stripe.js does,
   * and confirms the order only once the payment was taken. When unset, or
   * when it cannot read the PaymentIntent, resume uses the key EP Stripe
   * Payment sends with the request, and refuses a request it cannot verify.
   */
  publishableKey?: string;
  /** Connected Stripe account (`acct_…`) the PaymentIntents live on. */
  stripeAccount?: string;
}

/** The PaymentIntent's amount (minor units), when Elastic Path reports it. */
function amountOf(pi: { amount?: unknown } | undefined): { amount?: number } {
  return typeof pi?.amount === "number" && Number.isFinite(pi.amount)
    ? { amount: pi.amount }
    : {};
}

/**
 * Reads a PaymentIntent the way Stripe.js `retrievePaymentIntent` does: its
 * client secret plus a publishable key. The read changes nothing.
 */
async function readStripePaymentIntent(
  paymentIntentId: string,
  clientSecret: string,
  keys: PaymentIntentReadKeys
): Promise<CartPaymentIntentState> {
  const query = new URLSearchParams({
    client_secret: clientSecret,
    key: keys.publishableKey,
  });
  if (keys.stripeAccount) query.set("_stripe_account", keys.stripeAccount);
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?${query}`
    );
    if (!res.ok) return "unreadable";
    const pi = (await res.json()) as { id?: unknown; status?: unknown };
    if (pi?.id !== paymentIntentId || typeof pi.status !== "string") {
      return "unreadable";
    }
    switch (paymentIntentPhase(pi.status)) {
      case "settled":
        return "settled";
      case "pending":
        return "awaiting_action";
      case "failed":
        return "failed";
      default:
        return "unreadable";
    }
  } catch {
    return "unreadable";
  }
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
): CartPaymentIntentAdapter {
  const { host, getClientCredentialsToken, getShopperToken } = config;
  const configuredKeys: PaymentIntentReadKeys | undefined = config.publishableKey
    ? { publishableKey: config.publishableKey, stripeAccount: config.stripeAccount }
    : undefined;

  return {
    paymentSequence: "cart_payment_intent",
    async readPaymentIntentState(session, requestKeys) {
      const tries = [configuredKeys, requestKeys].filter(
        (k): k is PaymentIntentReadKeys => !!k
      );
      if (tries.length === 0) return "unverifiable";
      const clientSecret = session.payment.clientToken;
      const paymentIntentId = session.payment.gatewayMetadata?.paymentIntentId;
      if (typeof clientSecret !== "string" || typeof paymentIntentId !== "string") {
        return "unreadable";
      }
      let state: CartPaymentIntentState = "unreadable";
      for (const keys of tries) {
        state = await readStripePaymentIntent(paymentIntentId, clientSecret, keys);
        if (state !== "unreadable") break;
      }
      return state;
    },
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
      const clientSecret: string | undefined =
        typeof pi?.client_secret === "string" ? pi.client_secret : undefined;

      const phase = paymentIntentPhase(piStatus);
      if (phase === "pending" && piId) {
        return {
          status: "requires_action",
          clientToken: clientSecret,
          gatewayMetadata: { paymentIntentId: piId, ...amountOf(pi) },
          actionData: {
            type: piStatus === "processing" ? "stripe_processing" : "stripe_3ds",
            paymentIntentId: piId,
          },
        };
      }

      // Success when the PI confirmed (succeeded / requires_capture for an
      // auth), or — tolerant fallback — when EP returned a PaymentIntent id
      // with no error (confirm:true ran). The order is then created + synced
      // via confirmOrder downstream.
      const succeeded =
        !epError && !!piId && (piStatus === undefined || phase === "settled");
      if (succeeded) {
        return {
          status: "succeeded",
          gatewayOrderId: piId!,
          gatewayMetadata: { paymentIntentId: piId!, ...amountOf(pi) },
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
  };
}
