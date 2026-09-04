/**
 * PaymentRegistrationContext — internal React context for gateway self-registration.
 *
 * When a designer drops EPCloverPayment or EPStripePayment inside
 * EPCheckoutSessionProvider, the gateway component registers itself via this
 * context. The provider reads the registration to know which gateway to use
 * when placeOrder() is called.
 *
 * Uses the Symbol.for singleton pattern (matching BundleContext, CheckoutContext)
 * to survive CJS + ESM dual-loading and HMR.
 */
import React, { useContext } from "react";

/**
 * Session slice returned by /pay and passed into Stripe's requires_action
 * continuation. clientToken is the server-persisted PaymentIntent
 * client_secret — not a client-claimed PI id or status.
 */
export interface GatewayPaySession {
  status?: string;
  payment?: {
    gateway?: string | null;
    status?: string;
    clientToken?: string | null;
  } | null;
}

export interface GatewayContinuationResult {
  success?: boolean;
  data?: { session?: GatewayPaySession | null };
  error?: { message?: string; code?: string };
  paymentError?: string;
}

export interface GatewayRegistration {
  name: string;
  /** Called by the provider to get gateway-specific data for the /pay request. */
  confirm: () => Promise<Record<string, unknown>>;
  /**
   * Stripe-only. After /pay returns requires_action, the provider awaits this
   * to run handleNextAction + resumePayment. Clover omits it.
   */
  completeRequiresAction?: (
    paySession: GatewayPaySession
  ) => Promise<GatewayContinuationResult>;
}

export interface PaymentRegistrationContextValue {
  registerGateway(
    name: string,
    confirm: GatewayRegistration["confirm"],
    options?: Pick<GatewayRegistration, "completeRequiresAction">
  ): void;
  getRegisteredGateway(): GatewayRegistration | null;
}

const PAYMENT_REG_CTX_KEY = Symbol.for(
  "@elasticpath/ep-payment-registration-context"
);

function getSingletonContext<T>(
  key: symbol
): React.Context<T | null> {
  const g = globalThis as any;
  if (!g[key]) {
    g[key] = React.createContext<T | null>(null);
  }
  return g[key];
}

export const PaymentRegistrationContext =
  getSingletonContext<PaymentRegistrationContextValue>(PAYMENT_REG_CTX_KEY);

export function usePaymentRegistration(): PaymentRegistrationContextValue | null {
  return useContext(PaymentRegistrationContext);
}
