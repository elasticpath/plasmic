import {
  GlobalActionDict,
  GlobalActionsProvider,
  GlobalContextMeta,
} from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import { globalActionsRegistrations } from "@plasmicpkgs/commerce";
import React from "react";
import { mutate as swrMutate } from "swr";
import { getCommerceProvider } from "./elastic-path";
import { ElasticPathCredentials } from "./provider";
import { Registerable } from "./registerable";
import { ServerCartActionsProvider } from "./shopper-context/ServerCartActionsProvider";
import { callEpProxy } from "./ep-server-functions/proxy-fetch";
import { epCartCacheKey } from "./cart-provider/cache-keys";

interface CommerceProviderProps extends ElasticPathCredentials {
  children?: React.ReactNode;
  locale?: string;
  customHost?: string;
  serverCartMode?: boolean;
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
    serverCartMode: {
      type: "boolean",
      displayName: "Server Cart Mode",
      description:
        "When enabled, cart operations use server routes instead of client-side EP SDK. No client ID is needed for cart operations.",
      advanced: true,
      defaultValue: false,
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
    serverCartMode = false,
  } = props;

  if (!clientId) {
    if (serverCartMode) {
      return (
        <ServerCartActionsProvider globalContextName={globalContextName}>
          {children}
        </ServerCartActionsProvider>
      );
    }
    return (
      <div>
        Please set your Elastic Path Client ID in the Elastic Path Provider
        settings.
      </div>
    );
  }

  const resolvedHost = host === "custom" ? customHost : host;

  const creds = React.useMemo(
    () => ({ clientId, host: resolvedHost }),
    [clientId, resolvedHost]
  );

  const CommerceProvider = React.useMemo(
    () => getCommerceProvider(creds, locale),
    [creds, locale]
  );

  return (
    <CommerceProvider>
      {serverCartMode ? (
        <ServerCartActionsProvider globalContextName={globalContextName}>
          {children}
        </ServerCartActionsProvider>
      ) : (
        <EpCartActionsProvider globalContextName={globalContextName}>
          {children}
        </EpCartActionsProvider>
      )}
    </CommerceProvider>
  );
}

interface EpCartActions extends GlobalActionDict {
  addItem: (productId: string, variantId: string, quantity: number) => void;
  updateItem: (lineItemId: string, quantity: number) => void;
  removeItem: (lineItemId: string) => void;
}

function EpCartActionsProvider(
  props: React.PropsWithChildren<{ globalContextName: string }>
) {
  const actions: EpCartActions = React.useMemo(
    () => ({
      async addItem(productId, variantId, quantity) {
        await callEpProxy(
          "addCartItem",
          { productId: variantId || productId, quantity },
          null
        );
        await swrMutate(epCartCacheKey());
      },
      async updateItem(lineItemId, quantity) {
        if (quantity < 1) {
          await callEpProxy(
            "removeCartItem",
            { itemId: lineItemId },
            null
          );
        } else {
          await callEpProxy(
            "updateCartItem",
            { itemId: lineItemId, quantity },
            null
          );
        }
        await swrMutate(epCartCacheKey());
      },
      async removeItem(lineItemId) {
        await callEpProxy(
          "removeCartItem",
          { itemId: lineItemId },
          null
        );
        await swrMutate(epCartCacheKey());
      },
    }),
    []
  );

  return (
    <GlobalActionsProvider
      contextName={props.globalContextName}
      actions={actions}
    >
      {props.children}
    </GlobalActionsProvider>
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
