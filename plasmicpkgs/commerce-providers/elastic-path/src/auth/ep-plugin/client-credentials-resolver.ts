/**
 * Client Credentials Token Resolver — server-only, request-scoped factory
 * for EP admin tokens.
 *
 * The host app's per-request checkout-context factory builds a fresh resolver
 * for every incoming request. The closure memoizes the minted token so that
 * a single request that needs the admin token in multiple places (e.g.
 * `createCartPaymentIntent`, `checkoutApi`, `confirmOrder`, cart cleanup)
 * mints once and reuses.
 *
 * Distinct resolver instances do not share state — there is no process-level
 * cache. The closure is GC'd at request end.
 */

export interface ClientCredentialsResolverConfig {
  host: string;
  clientId: string;
  clientSecret: string;
}

export type ClientCredentialsTokenResolver = () => Promise<string>;

interface EpClientCredentialsTokenResponse {
  access_token: string;
  expires: number;
  expires_in: number;
  token_type: string;
}

export function createClientCredentialsTokenResolver(
  config: ClientCredentialsResolverConfig
): ClientCredentialsTokenResolver {
  const { host, clientId, clientSecret } = config;
  let pending: Promise<string> | null = null;

  return async function getClientCredentialsToken(): Promise<string> {
    if (pending) return pending;
    pending = (async () => {
      const url = `${host}/oauth/access_token`;
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "<no body>");
        throw new Error(
          `EP client_credentials grant failed (${response.status}): ${text}`
        );
      }
      const data = (await response.json()) as EpClientCredentialsTokenResponse;
      return data.access_token;
    })();
    return pending;
  };
}
