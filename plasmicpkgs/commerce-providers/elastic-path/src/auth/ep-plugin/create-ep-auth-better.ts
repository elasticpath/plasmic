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
import { nextCookies } from "better-auth/next-js";
import { epPlugin } from "./ep-plugin";
import { DEFAULT_HOST_ALLOWLIST } from "../host-allowlist";
import {
  assertNonSentinelSecret,
  resolveAuthSecret,
} from "./production-guard";

export interface CreateEpAuthBetterInput {
  clientId: string;
  host: string;
  secret?: string;
  basePath?: string;
  baseURL?: string;
  /**
   * Origins allowed to call the auth handler. Better-auth rejects
   * requests with an Origin header outside this list (default: strict
   * match against `baseURL`). For Next.js dev where you may hit either
   * `localhost:3456` OR `127.0.0.1:3456`, both must be listed.
   *
   * If omitted, the factory infers a sensible dev default by including
   * both the localhost and 127.0.0.1 variants of `baseURL`.
   */
  trustedOrigins?: string[];
  hostAllowlist?: string[];
  cartMergeStrategy?: "merge" | "replace" | "prompt";
  checkout?: { sessionSecret: string };
  adapters?: { stripe?: { secretKey: string }; clover?: any };
  epClientSecret?: string;
  /**
   * Per-request resolver for clientId/host. Lets the consumer pull
   * config from the Plasmic loader bundle on each call instead of
   * pinning at factory construction. Forwarded directly to `epPlugin`.
   */
  resolveConfig?: () => Promise<
    { clientId?: string; host?: string } | null | undefined
  >;
}

function defaultTrustedOrigins(baseURL: string): string[] {
  const out = new Set<string>([baseURL]);
  // Add localhost↔127.0.0.1 variants so dev hits via either resolve.
  try {
    const u = new URL(baseURL);
    if (u.hostname === "localhost") {
      out.add(`${u.protocol}//127.0.0.1${u.port ? `:${u.port}` : ""}`);
    } else if (u.hostname === "127.0.0.1") {
      out.add(`${u.protocol}//localhost${u.port ? `:${u.port}` : ""}`);
    }
  } catch {
    // Non-URL baseURL — leave the set as-is.
  }
  return [...out];
}

/** Mirrors better-auth's own getTrustedOrigins (ADR-0001). */
function resolveTrustedOrigins(
  configured: string[] | undefined,
  baseURL: string
): string[] {
  const out = new Set<string>(configured ?? defaultTrustedOrigins(baseURL));
  try {
    out.add(new URL(baseURL).origin);
  } catch {}
  for (const origin of (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(
    ","
  )) {
    const trimmed = origin.trim();
    if (trimmed) out.add(trimmed);
  }
  return [...out];
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
  /**
   * The underlying better-auth instance. Use with `toNextJsHandler` from
   * `better-auth/next-js` to mount the auth handler at `/api/ep/[...all]`:
   *
   *   import { toNextJsHandler } from "better-auth/next-js";
   *   import { epAuth } from "@/lib/ep-auth";
   *   export const { GET, POST } = toNextJsHandler(epAuth.handler);
   */
  handler: any;
  config: {
    basePath: string;
    trustedOrigins: string[];
    hostAllowlist: readonly string[];
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

/**
 * Auto-refresh threshold (seconds). When session.epExpires is within
 * this many seconds of `now`, the next getSession() call rotates the
 * EP token via /ep/refresh transparently. 30s is enough buffer to
 * avoid serving an EP API call with a token that expires mid-request,
 * without rotating so eagerly that we trash the cache cluster.
 */
const REFRESH_THRESHOLD_SECONDS = 30;

function isNearExpiry(epExpires: number): boolean {
  if (!epExpires) return false;
  return epExpires <= Math.floor(Date.now() / 1000) + REFRESH_THRESHOLD_SECONDS;
}

function extractSetCookies(response: Response): string[] {
  const out: string[] = [];
  response.headers.forEach((value: string, key: string) => {
    if (key.toLowerCase() === "set-cookie") out.push(value);
  });
  return out;
}

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
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
  assertNonSentinelSecret(input.checkout?.sessionSecret, {
    label: "createEpAuth checkout.sessionSecret",
  });
  if (!input.clientId) {
    throw new Error("clientId is required");
  }
  const secret = resolveAuthSecret(input.secret, { label: "createEpAuth" });

  const basePath = input.basePath ?? "/api/ep";
  const baseURL = input.baseURL ?? "http://localhost";
  const trustedOrigins = resolveTrustedOrigins(input.trustedOrigins, baseURL);

  const auth = betterAuth({
    secret,
    baseURL,
    basePath,
    trustedOrigins,
    plugins: [
      epPlugin({
        clientId: input.clientId,
        host: input.host,
        hostAllowlist: input.hostAllowlist,
        resolveConfig: input.resolveConfig,
      }),
      // `nextCookies()` MUST be the last plugin in the array per
      // better-auth's docs. It auto-forwards Set-Cookie headers from
      // server actions / route handlers into Next's `cookies()` writer,
      // so /api/ep/* responses persist their session cookies without
      // any manual handling on the consumer side.
      nextCookies(),
    ],
    session: {
      cookieCache: {
        enabled: true,
        strategy: "jwe" as any,
        refreshCache: true,
      },
    } as any,
  });

  const config = Object.freeze({
    basePath,
    trustedOrigins,
    hostAllowlist: input.hostAllowlist ?? DEFAULT_HOST_ALLOWLIST,
    cartMergeStrategy: input.cartMergeStrategy ?? "merge",
    checkout: input.checkout,
    adapters: input.adapters,
    epClientSecret: input.epClientSecret,
  });

  return {
    api: {
      async getSession(req) {
        const reqHeaders = buildHeaders(req.cookies, req.headers);
        const pendingSetCookies: string[] = [];

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
          for (const c of extractSetCookies(anonResponse)) {
            pendingSetCookies.push(c);
          }
          const body = await anonResponse.json();
          session = body;
        }

        // Refresh-on-expiry: if the session's EP token is about to
        // expire (or already has), transparently rotate via /ep/refresh.
        // The catchall page sees a fresh token without writing extra
        // logic; commitCookies() flushes the rotated session_data
        // cookie alongside any bootstrap cookies.
        const sessionExpires = session?.session?.epExpires ?? 0;
        if (isNearExpiry(sessionExpires)) {
          // Build cookie header that combines incoming cookies + any
          // freshly-bootstrapped Set-Cookies, so /ep/refresh sees the
          // current session identity rather than minting a new anon.
          const carriedCookies = pendingSetCookies.length
            ? cookieHeaderFromSetCookies(pendingSetCookies)
            : cookiesToHeader(req.cookies);
          const refreshHeaders = new Headers({ cookie: carriedCookies });
          if (req.headers) {
            for (const [k, v] of Object.entries(req.headers)) {
              if (k.toLowerCase() !== "cookie") {
                refreshHeaders.set(k, v);
              }
            }
          }
          const refreshResponse = await (auth.api as any).epRefresh({
            body: {},
            headers: refreshHeaders,
            asResponse: true,
          });
          if (refreshResponse.ok) {
            // Rotated cookies replace the bootstrap ones — same names
            // overwrite, so the final commitCookies() emits the
            // freshest session.
            for (const c of extractSetCookies(refreshResponse)) {
              pendingSetCookies.push(c);
            }
            const refreshed = await refreshResponse.json();
            session = refreshed;
          }
          // If refresh fails (e.g. EP outage), fall through with the
          // near-expiry session — better than failing the page render.
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
          // Serialized into page HTML via globalContextsProps.
          providerProps() {
            return {};
          },
          commitCookies(res) {
            for (const cookie of pendingSetCookies) {
              res.appendHeader("Set-Cookie", cookie);
            }
          },
        };
      },
    },
    handler: auth,
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
