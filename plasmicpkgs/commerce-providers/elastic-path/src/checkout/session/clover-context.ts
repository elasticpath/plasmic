/**
 * CloverElementsContext — internal React context for sharing the Clover SDK
 * elements instance between EPCloverPayment and child card field components.
 *
 * WHY: Clover's SDK allows only one set of payment fields per page. All field
 * components (card number, expiry, CVV, postal code) must share a single Clover
 * instance and elements factory for tokenization to work correctly.
 *
 * Uses the Symbol.for singleton pattern (matching BundleContext, CheckoutContext,
 * PaymentRegistrationContext) to survive CJS + ESM dual-loading and HMR.
 */
import React, { useContext } from "react";
import type { CloverElementsInstance, CloverSdkInstance } from "./adapters/clover-types";

export interface CloverElementsContextValue {
  /** The Clover elements factory for creating iframe fields. */
  elements: CloverElementsInstance | null;
  /** The Clover SDK instance for tokenization. */
  clover: CloverSdkInstance | null;
  /** Whether the SDK has finished loading. */
  isReady: boolean;
  /** Error from SDK initialization, if any. */
  error: string | null;
}

const CLOVER_CTX_KEY = Symbol.for(
  "@elasticpath/ep-clover-elements-context"
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

export const CloverElementsContext =
  getSingletonContext<CloverElementsContextValue>(CLOVER_CTX_KEY);

export function useCloverElements(): CloverElementsContextValue | null {
  return useContext(CloverElementsContext);
}
