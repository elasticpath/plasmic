import React, { useMemo } from "react";

export interface ShopperOverrides {
  cartId?: string;
  accountId?: string;
  locale?: string;
  currency?: string;
  basePath?: string;
}

// ---------------------------------------------------------------------------
// Use Symbol.for + globalThis to guarantee singleton context even if the
// bundle is loaded multiple times (e.g. CJS + ESM, HMR).
// Matches BundleContext.tsx / CartDrawerContext.tsx pattern.
//
// NOTE: Default value is {} (empty overrides = production mode),
// NOT null like BundleContext which requires a provider. ShopperContext
// should work without a provider (hooks return {} = no overrides).
// ---------------------------------------------------------------------------

const SHOPPER_CTX_KEY = Symbol.for("@elasticpath/ep-shopper-context");

function getSingletonContext(): React.Context<ShopperOverrides> {
  const g = globalThis as any;
  if (!g[SHOPPER_CTX_KEY]) {
    g[SHOPPER_CTX_KEY] = React.createContext<ShopperOverrides>({});
  }
  return g[SHOPPER_CTX_KEY];
}

export function getShopperContext() {
  return getSingletonContext();
}

export interface ShopperContextProps extends ShopperOverrides {
  children?: React.ReactNode;
}

/**
 * ShopperContext GlobalContext — provides override channel for cart identity.
 *
 * Priority: URL query param (injected by consumer) > Plasmic prop > empty (server uses cookie)
 *
 * In Plasmic Studio: designer fills cartId in GlobalContext settings.
 * In production checkout: consumer wraps in ShopperContext with cartId from URL.
 * In production browsing: no overrides — server resolves from httpOnly cookie.
 */
export function ShopperContext({
  cartId,
  accountId,
  locale,
  currency,
  basePath,
  children,
}: ShopperContextProps) {
  const ShopperCtx = getSingletonContext();

  const effective = useMemo<ShopperOverrides>(
    () => ({
      cartId: cartId || undefined,
      accountId: accountId || undefined,
      locale: locale || undefined,
      currency: currency || undefined,
      basePath: basePath || undefined,
    }),
    [cartId, accountId, locale, currency, basePath]
  );

  return (
    <ShopperCtx.Provider value={effective}>{children}</ShopperCtx.Provider>
  );
}
