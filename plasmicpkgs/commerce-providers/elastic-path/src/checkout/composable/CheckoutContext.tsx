/**
 * Shared checkout context — connects EPCheckoutProvider with EPPaymentElements.
 *
 * EPCheckoutProvider sets `clientSecret` after calling setupPayment().
 * EPPaymentElements reads `clientSecret` to initialise Stripe Elements,
 * then sets `stripeElements` so EPCheckoutProvider can call confirmPayment().
 *
 * Uses the singleton Symbol.for pattern (matching BundleContext.tsx) to survive
 * CJS + ESM dual-loading and HMR.
 */
import React, { useContext } from "react";

export interface CheckoutPaymentContextValue {
  /** Stripe PaymentIntent client secret — set by EPCheckoutProvider after setupPayment(). */
  clientSecret: string | null;
  /** Stripe Elements instance — set by EPPaymentElements after mount. */
  stripeElements: any | null;
  /** Called by EPPaymentElements to register its Elements instance. */
  setStripeElements: (elements: any | null) => void;
}

const CHECKOUT_PAYMENT_CTX_KEY = Symbol.for(
  "@elasticpath/ep-checkout-payment-context"
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

export const CheckoutPaymentContext =
  getSingletonContext<CheckoutPaymentContextValue>(CHECKOUT_PAYMENT_CTX_KEY);

export function useCheckoutPaymentContext(): CheckoutPaymentContextValue | null {
  return useContext(CheckoutPaymentContext);
}
