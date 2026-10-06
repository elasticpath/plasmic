import { useMemo } from "react";
import { createEpIdentityClient } from "./client";
import type { EpIdentityClient } from "./operations";

/**
 * The identity operations as methods, against the default mount path. A
 * consumer who moved the auth handler builds the client with
 * `createEpIdentityClient({ basePath })` instead.
 */
export function useEpIdentity(): EpIdentityClient {
  return useMemo(() => createEpIdentityClient(), []);
}
