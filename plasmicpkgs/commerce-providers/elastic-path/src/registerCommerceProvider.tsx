import { GlobalContextMeta } from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import { usePlasmicQueryData } from "@plasmicapp/query";
import {
  CartActionsProvider,
  globalActionsRegistrations,
} from "@plasmicpkgs/commerce";
import React from "react";
import { getCommerceProvider } from "./elastic-path";
import { ElasticPathCredentials } from "./provider";
import { Registerable } from "./registerable";

interface CommerceProviderProps extends ElasticPathCredentials {
  children?: React.ReactNode;
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
      type: "string",
      defaultValue: "https://euwest.api.elasticpath.com",
      description:
        "Elastic Path API endpoint (e.g., https://euwest.api.elasticpath.com)",
    },
  },
  ...{ globalActions: globalActionsRegistrations },
  importPath: "@plasmicpkgs/commerce-elastic-path",
  importName: "CommerceProviderComponent",
};

export function CommerceProviderComponent(props: CommerceProviderProps) {
  const { children, clientId, host } = props;

  const creds = React.useMemo(() => ({ clientId, host }), [clientId, host]);

  const {
    data: locale,
    error,
    isLoading,
  } = usePlasmicQueryData(JSON.stringify({ creds }) + "locale", async () => {
    // Elastic Path doesn't have a project concept like Commercetools
    // Default to en-US, but this could be made configurable
    return "en-US";
  });

  const CommerceProvider = React.useMemo(
    () => getCommerceProvider(creds, locale ?? "en-US"),
    [creds, locale]
  );

  if (isLoading) {
    return null;
  } else if (error) {
    throw new Error(error.message);
  }

  return (
    <CommerceProvider>
      <CartActionsProvider globalContextName={globalContextName}>
        {children}
      </CartActionsProvider>
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
