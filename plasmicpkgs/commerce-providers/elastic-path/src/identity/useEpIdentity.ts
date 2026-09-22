import { useMemo } from "react";
import { useShopperContext } from "../shopper-context/useShopperContext";
import { createEpIdentityClient, DEFAULT_EP_BASE_PATH } from "./client";
import type { EpIdentityClient } from "./operations";

/**
 * The identity operations as methods. The base path comes from the shopper
 * context, so a consumer who moved the auth handler configures nothing here.
 */
export function useEpIdentity(): EpIdentityClient {
  const { basePath = DEFAULT_EP_BASE_PATH } = useShopperContext();
  return useMemo(() => createEpIdentityClient({ basePath }), [basePath]);
}
