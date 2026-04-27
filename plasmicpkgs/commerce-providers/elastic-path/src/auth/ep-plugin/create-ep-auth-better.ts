/**
 * Better-auth-backed `createEpAuth` (PRD #273).
 *
 * Re-implements the public surface of the original hand-rolled
 * `createEpAuth` (in ../create-ep-auth.ts) on top of better-auth's
 * stateless cookie-cache mode. Consumers see exactly the same shape:
 *
 *   const epAuth = createEpAuth({ clientId, host, ... });
 *   const session = await epAuth.api.getSession({ cookies, headers });
 *   //  → { session, user, cart, isAuthenticated, headers(),
 *   //      providerProps(), commitCookies() }
 *
 * Internally:
 *   - Wraps `betterAuth({ secret, plugins: [epPlugin(...)], ... })`
 *   - Maps {cookies, headers} input → Headers object → auth.api.getSession
 *   - Maps better-auth's {user, session} → our EpSession shape
 *   - Bootstrap: when no cookie carries a session, calls `/ep/anonymous`
 *     to mint one and queues the resulting Set-Cookie headers for
 *     `commitCookies()` to flush back to the response
 *
 * Switchover path: this file lives alongside the legacy
 * ../create-ep-auth.ts during the deprecation window. The package
 * re-export flips to this implementation when the migration is complete.
 */
import { betterAuth } from "better-auth";
import { epPlugin } from "./ep-plugin";

export interface CreateEpAuthBetterInput {
  clientId: string;
  host: string;
  secret: string;
  basePath?: string;
  cartMergeStrategy?: "merge" | "replace" | "prompt";
  checkout?: { sessionSecret: string };
  adapters?: { stripe?: { secretKey: string }; clover?: any };
  epClientSecret?: string;
}

export interface EpSessionData {
  accessToken: string;
  expires: number;
  clientId: string;
  host: string;
}

export interface EpSession {
  session: EpSessionData | null;
  user: any | null;
  cart: { id: string } | null;
  isAuthenticated: boolean;
  headers(): Record<string, string>;
  providerProps(): Record<string, any>;
  commitCookies(res: { appendHeader(name: string, value: string): void }): void;
}

export interface EpAuth {
  api: {
    getSession(req: {
      cookies: Record<string, string>;
      headers?: Record<string, string>;
    }): Promise<EpSession>;
  };
  config: {
    basePath: string;
    cartMergeStrategy: "merge" | "replace" | "prompt";
    checkout?: { sessionSecret: string };
    adapters?: { stripe?: { secretKey: string }; clover?: any };
    epClientSecret?: string;
  };
}

function cookiesToHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

function buildHeaders(
  cookies: Record<string, string>,
  headers?: Record<string, string>
): Headers {
  const h = new Headers();
  if (headers) {
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
  }
  const cookieHeader = cookiesToHeader(cookies);
  if (cookieHeader) h.set("cookie", cookieHeader);
  return h;
}

export function createEpAuth(input: CreateEpAuthBetterInput): EpAuth {
  if (
    input.checkout?.sessionSecret &&
    input.checkout.sessionSecret.length < 16
  ) {
    throw new Error(
      "checkout.sessionSecret must be at least 16 characters"
    );
  }
  if (!input.clientId) {
    throw new Error("clientId is required");
  }
  if (!input.secret) {
    throw new Error("secret is required");
  }

  const auth = betterAuth({
    secret: input.secret,
    baseURL: "http://localhost",
    plugins: [epPlugin({ clientId: input.clientId, host: input.host })],
    session: {
      cookieCache: {
        enabled: true,
        strategy: "jwe" as any,
        refreshCache: true,
      },
    } as any,
  });

  const config = Object.freeze({
    basePath: input.basePath ?? "/api/ep",
    cartMergeStrategy: input.cartMergeStrategy ?? "merge",
    checkout: input.checkout,
    adapters: input.adapters,
    epClientSecret: input.epClientSecret,
  });

  return {
    api: {
      async getSession(req) {
        const reqHeaders = buildHeaders(req.cookies, req.headers);

        // First try to read an existing session from the cookies.
        let session: any = null;
        try {
          session = await auth.api.getSession({ headers: reqHeaders } as any);
        } catch {
          session = null;
        }

        // No existing session → bootstrap an anonymous one. Capture the
        // Set-Cookie headers from the response so commitCookies() can
        // forward them on the outgoing response.
        const pendingSetCookies: string[] = [];
        if (!session) {
          const anonResponse = await (auth.api as any).epAnonymous({
            body: {},
            headers: reqHeaders,
            asResponse: true,
          });
          if (!anonResponse.ok) {
            // Anonymous mint failed (e.g. EP unreachable). Return an empty
            // EpSession so callers fail-soft, same as the legacy impl.
            return makeEmptyEpSession(config);
          }
          anonResponse.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() === "set-cookie") {
              pendingSetCookies.push(value);
            }
          });
          const body = await anonResponse.json();
          session = body;
        }

        const epSession = session?.session ?? null;
        const epUser = session?.user ?? null;

        const sessionData: EpSessionData | null = epSession?.epAccessToken
          ? {
              accessToken: epSession.epAccessToken,
              expires: epSession.epExpires,
              clientId: epSession.epClientId,
              host: epSession.epHost,
            }
          : null;

        return {
          session: sessionData,
          user: epUser?.email?.endsWith("@anonymous.local") ? null : epUser,
          cart: epSession?.epCartId ? { id: epSession.epCartId } : null,
          isAuthenticated: Boolean(
            epUser && !epUser.email?.endsWith("@anonymous.local")
          ),
          headers() {
            const h: Record<string, string> = {};
            if (sessionData) {
              h["Authorization"] = `Bearer ${sessionData.accessToken}`;
            }
            return h;
          },
          providerProps() {
            if (!sessionData) return {};
            return { serverToken: sessionData.accessToken };
          },
          commitCookies(res) {
            for (const cookie of pendingSetCookies) {
              res.appendHeader("Set-Cookie", cookie);
            }
          },
        };
      },
    },
    config,
  };
}

function makeEmptyEpSession(config: any): EpSession {
  void config;
  return {
    session: null,
    user: null,
    cart: null,
    isAuthenticated: false,
    headers: () => ({}),
    providerProps: () => ({}),
    commitCookies: () => {},
  };
}
