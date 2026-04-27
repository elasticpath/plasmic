/**
 * Custom better-auth plugin that hosts EP-specific endpoints.
 *
 * Stateless mode: no `database` option on the parent `betterAuth({...})` —
 * sessions live entirely in the JWE `session_data` cookie. The plugin's
 * endpoints synthesize sessions and persist EP-specific fields via
 * `setSessionCookie(ctx, { user, session })` (the spike-verified pattern;
 * see memory/project_better_auth_stateless_findings.md).
 */
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie, getCookieCache } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";

export interface EpPluginOptions {
  /**
   * Default clientId. Used when `resolveConfig` is not supplied OR when
   * `resolveConfig` returns null.
   */
  clientId: string;
  /** Default host. Same fallback rules as `clientId`. */
  host: string;
  /**
   * Optional async resolver. Invoked on every endpoint call. Lets the
   * consumer pull config from elsewhere — e.g. the Plasmic loader bundle
   * via `extractEpProviderConfig(prefetchedData)` — instead of pinning
   * static values at plugin construction. The legacy auth had this same
   * shape via the `x-ep-client-id` / `x-ep-host` middleware-header
   * escape hatch in createEpSession; here we just lift it to a function.
   */
  resolveConfig?: () => Promise<
    { clientId?: string; host?: string } | null | undefined
  >;
}

interface EpAnonymousTokenResponse {
  access_token: string;
  expires: number;
  expires_in: number;
  token_type: string;
}

interface SessionContextSnapshot {
  user: any;
  session: any;
}

async function mintAnonymousEpToken(
  clientId: string,
  host: string
): Promise<EpAnonymousTokenResponse> {
  const url = `${host}/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "implicit",
    client_id: clientId,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new Error(`EP OAuth failed (${response.status}): ${text}`);
  }
  return (await response.json()) as EpAnonymousTokenResponse;
}

function generateAnonymousId(): string {
  // Random ID for the synthesized anonymous user. Cookie cache only —
  // never stored in any DB. 16 hex chars is plenty for collision avoidance
  // within a session's lifetime.
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveConfigFor(options: EpPluginOptions) {
  const resolved = options.resolveConfig
    ? await options.resolveConfig().catch(() => null)
    : null;
  return {
    clientId: resolved?.clientId ?? options.clientId,
    host: resolved?.host ?? options.host,
  };
}

function buildAnonymousSnapshot(
  tokenData: EpAnonymousTokenResponse,
  clientId: string,
  host: string
): SessionContextSnapshot {
  const now = Math.floor(Date.now() / 1000);
  const anonymousId = generateAnonymousId();

  const user = {
    id: `anon-${anonymousId}`,
    email: `anon-${anonymousId}@anonymous.local`,
    emailVerified: false,
    name: "Anonymous Shopper",
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const session = {
    id: `sess-${anonymousId}`,
    userId: user.id,
    token: anonymousId,
    expiresAt: new Date((now + tokenData.expires_in) * 1000),
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    // EP-specific fields — survive the cookie round-trip per the spike.
    epAccessToken: tokenData.access_token,
    epClientId: clientId,
    epHost: host,
    epExpires: tokenData.expires,
  };

  return { user, session };
}

/**
 * Reads the current session from the request cookies via better-auth's
 * cookie helper. Returns the parsed session object (with our EP fields)
 * or null when no valid cookie is present.
 *
 * Wraps better-auth's `getSessionCookie` (which uses the same JWE
 * decryption path the framework uses for `auth.api.getSession`) so
 * `/ep/refresh` can preserve identity across rotations.
 */
async function readExistingSession(ctx: any): Promise<any | null> {
  try {
    // Better-auth's `getCookieCache` decrypts the JWE session_data cookie
    // and returns the full payload including any custom fields written
    // via `setSessionCookie` (i.e., our EP fields). The session_token
    // cookie alone — what `getSessionCookie` returns — gives us only
    // the opaque token, not the EP payload we need to preserve.
    const headers: Headers =
      ctx.request?.headers ?? ctx.headers ?? new Headers();
    const cache = await getCookieCache(headers, {
      secret: ctx.context?.secret,
      strategy: "jwe",
      isSecure: ctx.context?.options?.useSecureCookies ?? false,
    } as any);
    if (!cache || !(cache as any).session || !(cache as any).user) {
      return null;
    }
    return { user: (cache as any).user, session: (cache as any).session };
  } catch {
    return null;
  }
}

export function epPlugin(options: EpPluginOptions): BetterAuthPlugin {
  return {
    id: "ep",
    endpoints: {
      epAnonymous: createAuthEndpoint(
        "/ep/anonymous",
        { method: "POST" },
        async (ctx) => {
          const { clientId, host } = await resolveConfigFor(options);
          const tokenData = await mintAnonymousEpToken(clientId, host);
          const snap = buildAnonymousSnapshot(tokenData, clientId, host);
          await setSessionCookie(ctx, snap as any);
          return ctx.json(snap);
        }
      ),

      epRefresh: createAuthEndpoint(
        "/ep/refresh",
        { method: "POST" },
        async (ctx) => {
          const { clientId, host } = await resolveConfigFor(options);
          const tokenData = await mintAnonymousEpToken(clientId, host);

          const existing = await readExistingSession(ctx);
          if (!existing || !existing.user || !existing.session) {
            // No valid prior session — behave like /ep/anonymous.
            const snap = buildAnonymousSnapshot(tokenData, clientId, host);
            await setSessionCookie(ctx, snap as any);
            return ctx.json(snap);
          }

          // Preserve identity (id, userId, etc.); rotate EP fields only.
          const session = {
            ...existing.session,
            updatedAt: new Date(),
            epAccessToken: tokenData.access_token,
            epClientId: clientId,
            epHost: host,
            epExpires: tokenData.expires,
          };
          const snap = { user: existing.user, session };
          await setSessionCookie(ctx, snap as any);
          return ctx.json(snap);
        }
      ),

      epAccountLogin: createAuthEndpoint(
        "/ep/account/login",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing || !existing.user || !existing.session) {
            return new Response(
              JSON.stringify({
                error: "no_session",
                message:
                  "No EP session — call /ep/anonymous first to bootstrap.",
              }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const body = (ctx.body as any) ?? {};
          const {
            epAccountId,
            epAccountToken,
            epAccountExpires,
            email,
            name,
          } = body;

          if (
            typeof epAccountId !== "string" ||
            typeof epAccountToken !== "string" ||
            typeof epAccountExpires !== "number"
          ) {
            return new Response(
              JSON.stringify({
                error: "invalid_input",
                message:
                  "Body must include { epAccountId, epAccountToken, epAccountExpires } from EP /v2/account-members/tokens.",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Upgrade the user record. Keep the same id/createdAt; switch
          // email + name to the real account values so downstream readers
          // can distinguish "real shopper" from "anonymous" via the
          // @anonymous.local sentinel.
          const user = {
            ...existing.user,
            email: typeof email === "string" ? email : existing.user.email,
            name: typeof name === "string" ? name : existing.user.name,
            updatedAt: new Date(),
          };

          const session = {
            ...existing.session,
            updatedAt: new Date(),
            epAccountId,
            epAccountToken,
            epAccountExpires,
          };

          await setSessionCookie(ctx, { session, user } as any);
          return ctx.json({ user, session });
        }
      ),

      epAccountLogout: createAuthEndpoint(
        "/ep/account/logout",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing || !existing.user || !existing.session) {
            return new Response(
              JSON.stringify({
                error: "no_session",
                message: "Nothing to log out.",
              }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Strip account fields. Restore an anonymous-looking user
          // record so consumers reading session.user.email find the
          // @anonymous.local sentinel and treat the session as
          // unauthenticated.
          const anonId = generateAnonymousId();
          const user = {
            ...existing.user,
            email: `anon-${anonId}@anonymous.local`,
            name: "Anonymous Shopper",
            updatedAt: new Date(),
          };
          const session = { ...existing.session, updatedAt: new Date() };
          delete (session as any).epAccountId;
          delete (session as any).epAccountToken;
          delete (session as any).epAccountExpires;

          await setSessionCookie(ctx, { session, user } as any);
          return ctx.json({ user, session });
        }
      ),

      epCart: createAuthEndpoint(
        "/ep/cart",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing || !existing.user || !existing.session) {
            return new Response(
              JSON.stringify({
                error: "no_session",
                message:
                  "No EP session — call /ep/anonymous first to bootstrap.",
              }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const cartId = (ctx.body as any)?.cartId;
          if (!cartId || typeof cartId !== "string") {
            return new Response(
              JSON.stringify({
                error: "invalid_input",
                message: "Body must include { cartId: string }.",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const session = {
            ...existing.session,
            updatedAt: new Date(),
            epCartId: cartId,
          };
          const snap = { user: existing.user, session };
          await setSessionCookie(ctx, snap as any);
          return ctx.json(snap);
        }
      ),
    },
  };
}
