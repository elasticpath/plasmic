import type { Client } from "@epcc-sdk/sdks-shopper";
import React from "react";
import initElasticPathClient from "../client";

export type { CurrencyDisplay } from "../utils/price";
import type { CurrencyDisplay } from "../utils/price";

export interface EpCommerce {
  client: Client;
  locale: string;
  /** ISO 4217 currency for the cart read (X-Moltin-Currency). Storefront-resolved. */
  currency?: string;
  /** Money display preference threaded into cart-data formatting. */
  currencyDisplay: CurrencyDisplay;
}

// ---------------------------------------------------------------------------
// Symbol.for + globalThis keeps this a singleton even if the bundle is loaded
// twice (CJS + ESM, HMR). Matches ShopperContext.tsx / BundleContext.tsx.
//
// Default is null, not {}: a provider is required, and the absence of one is a
// real state — CommerceProviderComponent renders children without a provider
// when no clientId is configured.
// ---------------------------------------------------------------------------

const EP_COMMERCE_CTX_KEY = Symbol.for("@elasticpath/ep-commerce-context");

function getSingletonContext(): React.Context<EpCommerce | null> {
  const g = globalThis as any;
  if (!g[EP_COMMERCE_CTX_KEY]) {
    g[EP_COMMERCE_CTX_KEY] = React.createContext<EpCommerce | null>(null);
  }
  return g[EP_COMMERCE_CTX_KEY];
}

export function getEpCommerceContext() {
  return getSingletonContext();
}

export interface EpCommerceProviderProps {
  clientId: string;
  host?: string;
  locale?: string;
  currency?: string;
  currencyDisplay?: CurrencyDisplay;
  children?: React.ReactNode;
}

/**
 * Props are primitives so the memo dependencies are stable by value. Passing a
 * `creds` object here instead would re-create the client on every render of the
 * parent, re-keying every downstream query.
 */
export function EpCommerceProvider({
  clientId,
  host,
  locale = "en-US",
  currency,
  currencyDisplay = "platform",
  children,
}: EpCommerceProviderProps) {
  const EpCommerceCtx = getSingletonContext();

  const client = React.useMemo(
    () => initElasticPathClient({ clientId, host }),
    [clientId, host]
  );

  const value = React.useMemo<EpCommerce>(
    () => ({ client, locale, currency, currencyDisplay }),
    [client, locale, currency, currencyDisplay]
  );

  return (
    <EpCommerceCtx.Provider value={value}>{children}</EpCommerceCtx.Provider>
  );
}

/** Returns null when no Elastic Path Provider is configured above this component. */
export function useEpCommerce(): EpCommerce | null {
  return React.useContext(getSingletonContext());
}
