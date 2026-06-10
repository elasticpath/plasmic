/**
 * StripeProvider — Plasmic global context that exposes the Stripe
 * publishable key to all `EPStripePayment` instances on a page.
 *
 * The publishable key is the Stripe `pk_live_*` / `pk_test_*` value. It
 * lives in `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and is exposed to Plasmic
 * pages by registering this global context with `publishableKey` bound to
 * `process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the host app.
 *
 * `EPStripePayment` reads `$ctx.stripe.publishableKey` as a fallback when
 * its `publishableKey` prop is unset.
 */
import React from "react";
import { DataProvider, GlobalContextMeta } from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import type { Registerable } from "../../registerable";

export interface StripeProviderProps {
  publishableKey?: string;
  children?: React.ReactNode;
}

export function StripeProvider({
  publishableKey,
  children,
}: StripeProviderProps) {
  const data = React.useMemo(
    () => ({ publishableKey: publishableKey || null }),
    [publishableKey]
  );
  return (
    <DataProvider name="stripe" data={data}>
      {children}
    </DataProvider>
  );
}

export const stripeProviderMeta: GlobalContextMeta<StripeProviderProps> = {
  name: "plasmic-commerce-ep-stripe-provider",
  displayName: "EP Stripe Provider",
  description:
    "Provides the Stripe publishable key to all EPStripePayment instances. " +
    "Bind `publishableKey` to NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in your host app.",
  props: {
    publishableKey: {
      type: "string",
      displayName: "Publishable Key",
      description: "Your Stripe pk_live_* or pk_test_*.",
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "StripeProvider",
  providesData: true,
};

export function registerStripeProvider(loader?: Registerable) {
  const doRegister: typeof registerGlobalContext = (...args) =>
    loader
      ? loader.registerGlobalContext(...args)
      : registerGlobalContext(...args);
  doRegister(StripeProvider, stripeProviderMeta);
}

