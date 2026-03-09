import { GlobalContextMeta } from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import {
  CartActionsProvider,
  globalActionsRegistrations,
} from "@plasmicpkgs/commerce";
import React from "react";
import { getCommerceProvider } from "./elastic-path";
import { ElasticPathCredentials } from "./provider";
import { Registerable } from "./registerable";
import { ServerCartActionsProvider } from "./shopper-context/ServerCartActionsProvider";

interface CommerceProviderProps extends ElasticPathCredentials {
  children?: React.ReactNode;
  locale?: string;
  customHost?: string;
  serverCartMode?: boolean;
}

const globalContextName = "plasmic-commerce-elastic-path-provider";

export const commerceProviderMeta: GlobalContextMeta<CommerceProviderProps> = {
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

  const ActionsProvider = serverCartMode
    ? ServerCartActionsProvider
    : CartActionsProvider;

  return (
    <CommerceProvider>
      <ActionsProvider globalContextName={globalContextName}>
        {children}
      </ActionsProvider>
    </CommerceProvider>
  );
}

export function registerCommerceProvider(
  loader?: Registerable,
  customCommerceProviderMeta?: GlobalContextMeta<CommerceProviderProps>
) {
  const doRegisterComponent: typeof registerGlobalContext = (...args) =>
    loader
      ? loader.registerGlobalContext(...args)
      : registerGlobalContext(...args);
  doRegisterComponent(
    CommerceProviderComponent,
    customCommerceProviderMeta ?? commerceProviderMeta
  );
}
