/**
 * getServerInfo implementation for the EP Commerce Provider global context.
 *
 * Bridges the serverToken prop (injected via globalContextsProps by the
 * consumer's page-level code) to child product components via providedContexts.
 * Child components read the token via ops.readContext("ep-server-token")
 * in their own getServerInfo implementations.
 *
 * Extracted from the registration meta so it can be unit-tested without
 * importing @plasmicapp/host (which doesn't resolve in the jest environment).
 */

export interface ServerInfo {
  providedContexts?: Array<{ contextKey: string; value: any }>;
  providedData?: Array<{ name: string; data: any }>;
  children?: any;
}

export function epProviderGetServerInfo(
  props: Record<string, any>,
  _ops: any
): ServerInfo {
  const serverToken = props.serverToken;
  if (!serverToken) return {};

  const host = props.host === "custom" ? props.customHost : props.host;

  return {
    providedContexts: [
      { contextKey: "ep-server-token", value: serverToken },
      { contextKey: "ep-host", value: host },
    ],
  };
}
