import { useMemo } from "react";
import { createEpIdentityClient } from "./client";
import type { EpIdentityClient } from "./operations";

/** The identity operations as methods, against the auth handler at `/api/ep`. */
export function useEpIdentity(): EpIdentityClient {
  return useMemo(() => createEpIdentityClient(), []);
}
