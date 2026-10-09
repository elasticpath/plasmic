import { GlobalContextMeta } from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import React from "react";
import { Registerable } from "./registerable";
import type { CurrencyDisplay } from "./utils/price";
import { EpCommerceProvider } from "./shopper-context/EpCommerceContext";
import { ServerCartActionsProvider } from "./shopper-context/ServerCartActionsProvider";
import { useEpDesignRealmBridge } from "./ep-server-functions/useEpDesignRealmBridge";

/**
 * Action and parameter names are a saved-binding contract: renaming one breaks
 * every designer interaction already bound to it.
 */
const globalActionsRegistrations = {
  addItem: {
    displayName: "Add item to cart",
    parameters: [
      { name: "productId", displayName: "Product Id", type: "string" },
      { name: "variantId", displayName: "Variant Id", type: "string" },
      { name: "quantity", displayName: "Quantity", type: "number" },
    ],
  },
  updateItem: {
    displayName: "Update item in cart",
    parameters: [
      { name: "lineItemId", displayName: "Line Item Id", type: "string" },
      { name: "quantity", displayName: "New Quantity", type: "number" },
    ],
  },
  removeItem: {
    displayName: "Remove item from cart",
    parameters: [
      { name: "lineItemId", displayName: "Line Item Id", type: "string" },
    ],
  },
} as const;

interface CommerceProviderProps {
  clientId: string;
  host?: string;
  children?: React.ReactNode;
  locale?: string;
  currency?: string;
  currencyDisplay?: CurrencyDisplay;
  customHost?: string;
}

const globalContextName = "plasmic-commerce-elastic-path-provider";

export const commerceProviderMeta: any = {
  name: globalContextName,
  displayName: "Elastic Path Provider",
  props: {
    clientId: {
      type: "string",
      defaultValue: "",
      description: "Your Elastic Path client ID (public key)",
    },
    host: {
      type: "choice",
      options: [
        { label: "EU West", value: "https://euwest.api.elasticpath.com" },
        { label: "US East", value: "https://useast.api.elasticpath.com" },
        { label: "Custom", value: "custom" },
      ],
      defaultValue: "https://euwest.api.elasticpath.com",
      description: "Elastic Path API region",
    },
    customHost: {
      type: "string",
      displayName: "Custom API Host",
      description: "Custom Elastic Path API endpoint URL",
      hidden: (props: any) => props.host !== "custom",
    },
    locale: {
      type: "choice",
      options: ["en-US", "en-GB", "fr-FR", "de-DE", "es-ES"],
      defaultValue: "en-US",
      description: "Locale for currency formatting and localization",
    },
    currency: {
      type: "string",
      displayName: "Currency",
      description:
        "Deprecated — ignored. The storefront server chooses the currency with createEpAuth's resolveLocaleAndCurrency, so a server render and a browser call price the cart the same way.",
      hidden: () => true,
      advanced: true,
    },
    currencyDisplay: {
      type: "choice",
      options: [
        { label: "As configured in Commerce Manager", value: "platform" },
        { label: "Symbol ($179.00)", value: "symbol" },
        { label: "Code (USD 179.00)", value: "code" },
      ],
      defaultValue: "platform",
      displayName: "Currency Display",
      description:
        "How money renders across product prices, cart lines and totals. The default uses Elastic Path's own formatted price, so a store's Commerce Manager settings are honoured; the other two re-format through the browser's Intl instead.",
      advanced: true,
    },
    serverCartMode: {
      type: "boolean",
      hidden: () => true,
      description:
        "Deprecated — ignored. Cart operations always run on the server.",
    },
    serverToken: {
      type: "string",
      hidden: () => true,
      description:
        "Deprecated — ignored. The shopper's Elastic Path credential never " +
        "reaches the browser.",
    },
  },
  ...{ globalActions: globalActionsRegistrations },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "CommerceProviderComponent",
};

export function CommerceProviderComponent(props: CommerceProviderProps) {
  useEpDesignRealmBridge();
  const {
    children,
    clientId,
    host,
    customHost,
    locale = "en-US",
    currencyDisplay = "platform",
  } = props;

  const cartActions = (
    <ServerCartActionsProvider globalContextName={globalContextName}>
      {children}
    </ServerCartActionsProvider>
  );

  if (!clientId) {
    return cartActions;
  }

  return (
    <EpCommerceProvider
      clientId={clientId}
      host={host === "custom" ? customHost : host}
      locale={locale}
      currencyDisplay={currencyDisplay}
    >
      {cartActions}
    </EpCommerceProvider>
  );
}

export function registerCommerceProvider(
  loader?: Registerable,
  customCommerceProviderMeta?: any
) {
  const doRegisterComponent: typeof registerGlobalContext = (...args) =>
    loader
      ? loader.registerGlobalContext(...args)
      : registerGlobalContext(...args);
  doRegisterComponent(
    CommerceProviderComponent,
    customCommerceProviderMeta ?? (commerceProviderMeta as any)
  );
}
