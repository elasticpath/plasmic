import { GlobalContextMeta } from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import React from "react";
import { ElasticPathCredentials } from "./client";
import { Registerable } from "./registerable";
import { EpCommerceProvider } from "./shopper-context/EpCommerceContext";
import { ServerCartActionsProvider } from "./shopper-context/ServerCartActionsProvider";

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

interface CommerceProviderProps extends ElasticPathCredentials {
  children?: React.ReactNode;
  locale?: string;
  currency?: string;
  currencyDisplay?: "symbol" | "code";
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
        "ISO 4217 currency code (e.g. USD, GBP, CHF) sent with the cart read so line prices and totals re-price for the active locale. Leave empty to use the cart's stored currency. Bind to your per-locale currency resolution.",
      advanced: true,
    },
    currencyDisplay: {
      type: "choice",
      options: [
        { label: "Symbol ($179.00)", value: "symbol" },
        { label: "Code (USD 179.00)", value: "code" },
      ],
      defaultValue: "symbol",
      displayName: "Currency Display",
      description:
        "How money renders across cart line prices and totals: a currency symbol or its ISO code prefix.",
      advanced: true,
    },
    // Retired, but hostless prop schemas are append-only: removing one
    // breaks hostless publishing for every package.
    serverCartMode: {
      type: "boolean",
      hidden: () => true,
      description: "Retired. Cart operations always use server routes.",
    },
    serverToken: {
      type: "string",
      hidden: () => true,
      description:
        "Retired. The shopper's EP access token never reaches the browser.",
    },
  },
  ...{ globalActions: globalActionsRegistrations },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "CommerceProviderComponent",
};

export function CommerceProviderComponent(props: CommerceProviderProps) {
  const {
    children,
    clientId,
    host,
    customHost,
    locale = "en-US",
    currency,
    currencyDisplay = "symbol",
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
      currency={currency}
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
