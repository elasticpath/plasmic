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
