import {
  parseEpTokenCookie,
  parseEpAccountCookie,
  parseEpCartCookie,
  buildEpTokenCookieHeader,
  isTokenExpired,
  EpTokenData,
  EpAccountData,
} from "./cookies";
import { resolveEpToken } from "./token";

export interface EpSessionConfig {
  clientId: string;
  host: string;
}

export interface EpSessionData {
  accessToken: string;
  expires: number;
  clientId: string;
  host: string;
}

export interface EpSession {
  session: EpSessionData | null;
  user: EpAccountData | null;
  cart: { id: string } | null;
  isAuthenticated: boolean;
  headers(): Record<string, string>;
  providerProps(): Record<string, any>;
  commitCookies(res: { appendHeader(name: string, value: string): void }): void;
}

export async function createEpSession(
  cookies: Record<string, string>,
  config: EpSessionConfig,
  middlewareHeaders?: Record<string, string>
): Promise<EpSession> {
  let tokenData: EpTokenData | null = null;
  let tokenWasResolved = false;

  // Try cookie first
  if (cookies.ep_token) {
    tokenData = parseEpTokenCookie(cookies.ep_token);
    if (tokenData && isTokenExpired(tokenData)) {
      tokenData = null;
    }
  }

  // If no valid token from cookie, resolve via OAuth
  if (!tokenData) {
    const clientId =
      middlewareHeaders?.["x-ep-client-id"] ?? config.clientId;
    const host = middlewareHeaders?.["x-ep-host"] ?? config.host;
    tokenData = await resolveEpToken(clientId, host);
    tokenWasResolved = true;
  }

  // Parse account cookie
  const accountData = cookies.ep_account
    ? parseEpAccountCookie(cookies.ep_account)
    : null;
  const accountExpired =
    accountData != null &&
    accountData.expires <= Math.floor(Date.now() / 1000);

  // Parse cart cookie
  const cartId = cookies.ep_cart
    ? parseEpCartCookie(cookies.ep_cart)
    : null;

  const sessionData: EpSessionData | null = tokenData
    ? {
        accessToken: tokenData.accessToken,
        expires: tokenData.expires,
        clientId: tokenData.clientId,
        host: tokenData.host,
      }
    : null;

  return {
    session: sessionData,
    user: accountData && !accountExpired ? accountData : null,
    cart: cartId ? { id: cartId } : null,
    isAuthenticated: accountData != null && !accountExpired,

    headers() {
      const h: Record<string, string> = {};
      if (sessionData) {
        h["Authorization"] = `Bearer ${sessionData.accessToken}`;
      }
      if (accountData && !accountExpired) {
        h["EP-Account-Management-Authentication-Token"] = accountData.token;
      }
      return h;
    },

    providerProps() {
      if (!sessionData) return {};
      return { serverToken: sessionData.accessToken };
    },

    commitCookies(res) {
      if (tokenWasResolved && tokenData) {
        res.appendHeader(
          "Set-Cookie",
          buildEpTokenCookieHeader(tokenData)
        );
      }
    },
  };
}
