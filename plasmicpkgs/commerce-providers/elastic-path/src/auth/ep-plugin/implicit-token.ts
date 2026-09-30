/**
 * Minting the store's anonymous Elastic Path credential, and choosing the
 * store to mint it against.
 *
 * Shared by the two callers that need a bare implicit token: the plugin's
 * `/ep/anonymous` bootstrap, which then wraps it in a shopper session, and
 * `createEpDesignRoutes`, which never does. The design route reads no session,
 * and this module is what lets it reuse the mint without importing a file that
 * does.
 */
import { isAllowedEpHost, reportRejectedEpHost } from "../host-allowlist";

export interface EpImplicitTokenResponse {
  access_token: string;
  expires: number;
  expires_in: number;
  token_type: string;
}

export async function mintImplicitEpToken(
  clientId: string,
  host: string
): Promise<EpImplicitTokenResponse> {
  const response = await fetch(`${host}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "implicit",
      client_id: clientId,
    }).toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new Error(`EP OAuth failed (${response.status}): ${text}`);
  }
  return (await response.json()) as EpImplicitTokenResponse;
}

export interface EpStoreConfig {
  clientId: string;
  host: string;
  hostAllowlist: readonly string[];
  resolveConfig?: (input: {
    hostAllowlist: readonly string[];
  }) => Promise<{ clientId?: string; host?: string } | null | undefined>;
}

/**
 * The store to mint against. A consumer reading its store from the Plasmic
 * bundle bootstraps the factory with placeholders, so the static pair alone
 * names a store that does not exist. A resolver naming a host outside the
 * allow-list is dropped whole — a client id is only valid against the host it
 * was resolved with.
 */
export async function resolveEpStore(
  config: EpStoreConfig,
  label: string
): Promise<{ clientId: string; host: string }> {
  const { clientId, host, hostAllowlist, resolveConfig } = config;
  const resolved = resolveConfig
    ? await resolveConfig({ hostAllowlist }).catch(() => null)
    : null;
  if (resolved?.host && !isAllowedEpHost(resolved.host, hostAllowlist)) {
    reportRejectedEpHost(resolved.host, label, hostAllowlist);
    return { clientId, host };
  }
  return {
    clientId: resolved?.clientId ?? clientId,
    host: resolved?.host ?? host,
  };
}
