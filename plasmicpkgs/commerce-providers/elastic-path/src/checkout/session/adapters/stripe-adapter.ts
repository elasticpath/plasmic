/**
 * Stripe PaymentAdapter — server-side adapter for Stripe payment processing.
 *
 * WHY: The session model needs a gateway-agnostic way to create PaymentIntents
 * and verify payment completion. This adapter translates between the
 * PaymentAdapter interface and Stripe's PaymentIntent API.
 *
 * Key behaviors:
 * - initializePayment: creates Stripe PaymentIntent with automatic_payment_methods,
 *   returns client_secret so the client-side can confirm with Stripe Elements
 * - confirmPayment: retrieves PaymentIntent by ID, validates metadata matches session,
 *   checks status === "succeeded"
 * - 3DS is handled entirely by Stripe's client-side SDK (no server-side 3DS logic)
 *
 * NOTE: Uses require('stripe') to lazy-load the server-side SDK. This prevents
 * the Stripe Node.js module from being pulled into client-side bundles. The
 * createStripeAdapter() factory is only called server-side (in consumer routes).
 */
import type { PaymentAdapter, PaymentAdapterResult, CheckoutSession } from "../types";

export interface StripeAdapterConfig {
  secretKey: string;
  apiVersion?: string;
}

export function createStripeAdapter(config: StripeAdapterConfig): PaymentAdapter {
  const { secretKey, apiVersion = "2023-10-16" } = config;

  // Lazy-require stripe to avoid pulling the Node.js SDK into client bundles.
  // tsdx externalizes dependencies, but consumer bundlers (webpack/turbopack)
  // would still resolve the import if it were top-level.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require("stripe");
  const stripe = new Stripe(secretKey, { apiVersion });

  return {
    async initializePayment(
      session: CheckoutSession,
      _gatewayData: Record<string, unknown>
    ): Promise<PaymentAdapterResult> {
      const orderId = session.order?.id;
      if (!orderId) {
        return { status: "failed", errorMessage: "No order ID in session" };
      }

      const total = session.totals?.total;
      const currency = session.totals?.currency;
      if (total == null || !currency) {
        return { status: "failed", errorMessage: "Missing totals in session" };
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: total,
          currency: currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata: {
            order_id: orderId,
            source: "ep-checkout-session",
          },
        });

        if (!paymentIntent.client_secret) {
          return {
            status: "failed",
            errorMessage: "Failed to create payment intent",
          };
        }

        return {
          status: "ready",
          clientToken: paymentIntent.client_secret,
          gatewayMetadata: { paymentIntentId: paymentIntent.id },
          gatewayOrderId: paymentIntent.id,
        };
      } catch (err: any) {
        if (err.type === "StripeCardError") {
          return { status: "failed", errorMessage: "Your card was declined" };
        }
        return {
          status: "failed",
          errorMessage: err.message || "Payment initialization failed",
        };
      }
    },

    async confirmPayment(
      session: CheckoutSession,
      confirmData: Record<string, unknown>
    ): Promise<PaymentAdapterResult> {
      const paymentIntentId = confirmData.paymentIntentId as string | undefined;
      if (!paymentIntentId) {
        return {
          status: "failed",
          errorMessage: "Missing paymentIntentId for Stripe confirmation",
        };
      }

      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          paymentIntentId
        );

        // Validate metadata matches session to prevent cross-session attacks
        const orderId = session.order?.id;
        if (orderId && paymentIntent.metadata?.order_id !== orderId) {
          return {
            status: "failed",
            errorMessage: "Payment intent does not match order",
          };
        }

        if (paymentIntent.status === "succeeded") {
          return {
            status: "succeeded",
            gatewayOrderId: paymentIntentId,
            gatewayMetadata: { paymentIntentId },
          };
        }

        if (paymentIntent.status === "requires_action") {
          return {
            status: "requires_action",
            gatewayMetadata: { paymentIntentId },
          };
        }

        if (paymentIntent.status === "requires_payment_method") {
          return {
            status: "failed",
            errorMessage: "Payment failed. Please try a different card.",
          };
        }

        return {
          status: "failed",
          errorMessage: `Payment not completed. Status: ${paymentIntent.status}`,
        };
      } catch (err: any) {
        return {
          status: "failed",
          errorMessage: err.message || "Payment confirmation failed",
        };
      }
    },
  };
}
