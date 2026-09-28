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
import {
  setSessionCookie,
  getCookieCache,
  SECURE_COOKIE_PREFIX,
} from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { epIdentityPayload } from "../../identity/operations";
import type {
  EpAccountLoginRequest,
  EpAccountRosterRequest,
  EpSelectAccountRequest,
  EpSetCartRequest,
} from "../../identity/operations";
import { isAllowedEpHost, reportRejectedEpHost } from "../host-allowlist";
import {
  EP_ACCOUNT_TOKEN_HEADER,
  accountNeedsRoll,
  applyAccountLapse,
  clearAccount,
  clearSessionCart,
  envelopeExpiresAt,
  holdAnchorToken,
  identifyMember,
  parseEpExpires,
  selectAccount,
  setSessionCart,
} from "./envelope";
import type { EpAccountSlot, EpAnchorTokenSlot } from "./envelope";
import {
  EpAccountTokenError,
  discoverPasswordProfileId,
  findAccountToken,
  mintAccountTokens,
  toAccountRoster,
} from "./account-tokens";
import type { EpAccountTokenPage } from "./account-tokens";
import { CHECKOUT_SESSION_COOKIE_NAME } from "../../checkout/session/cookie-name";
import { resolveSessionCart } from "./session-cart";
import type {
  EpSessionCartResolver,
  EpSessionCartTrigger,
  EpTransitionCtx,
} from "./session-cart";

export interface EpPluginOptions {
  /**
   * Default clientId. Used when `resolveConfig` is not supplied OR when
   * `resolveConfig` returns null.
   */
  clientId: string;
  /** Default host. Same fallback rules as `clientId`. */
  host: string;
  /**
   * Optional async resolver. Invoked on every mint. Lets the consumer pull
   * config from elsewhere — e.g. the Plasmic loader bundle via
   * `extractEpProviderConfig(prefetchedData, { hostAllowlist })` — instead
   * of pinning static values at plugin construction. A host it returns is
   * admitted only if it is on `hostAllowlist`.
   */
  resolveConfig?: EpResolveConfig;
  /** The resolved EP host allow-list; `createEpAuth` supplies it. */
  hostAllowlist: readonly string[];
  /**
   * The password profile account members sign in against. Discovered from the
   * store when omitted; required when the store's realm carries more than one,
   * because nothing in a profile record marks a default.
   */
  passwordProfileId?: string;
  /**
   * Chooses the session cart at a login or an account switch. Omitted, the
   * guest cart wins, and with no guest cart the account's most recently
   * updated one is adopted.
   */
  sessionCartResolver?: EpSessionCartResolver;
}

export type EpResolveConfig = (input: {
  hostAllowlist: readonly string[];
}) => Promise<{ clientId?: string; host?: string } | null | undefined>;

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
  const { hostAllowlist } = options;
  const resolved = options.resolveConfig
    ? await options.resolveConfig({ hostAllowlist }).catch(() => null)
    : null;
  if (resolved?.host && !isAllowedEpHost(resolved.host, hostAllowlist)) {
    reportRejectedEpHost(resolved.host, "epPlugin.resolveConfig", hostAllowlist);
    // clientId is only valid against the host it was resolved with.
    return { clientId: options.clientId, host: options.host };
  }
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
    // Independent of anonymousId: the user id and email are readable by the
    // storefront, and deriving the cookie's session token from them would
    // publish it.
    token: generateAnonymousId(),
    expiresAt: envelopeExpiresAt(now),
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
function usesSecureCookies(ctx: any): boolean {
  const nameBetterAuthChose = ctx?.context?.authCookies?.sessionData?.name;
  if (typeof nameBetterAuthChose === "string") {
    return nameBetterAuthChose.startsWith(SECURE_COOKIE_PREFIX);
  }
  return Boolean(ctx?.context?.options?.advanced?.useSecureCookies);
}

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
      isSecure: usesSecureCookies(ctx),
    } as any);
    if (!cache || !(cache as any).session || !(cache as any).user) {
      return null;
    }
    return { user: (cache as any).user, session: (cache as any).session };
  } catch {
    return null;
  }
}

/**
 * Verify an EP account token by calling EP's account endpoint with both
 * the shopper bearer and the account-management header. EP returns 200
 * with the account record only when the supplied token grants access to
 * the supplied accountId. Returns the canonical id from the response so
 * the session stores EP's source of truth, not the caller's claim.
 *
 * Returns null on any non-2xx, network failure, or shape mismatch — the
 * caller treats null as a hard rejection.
 */
async function verifyEpAccountToken(input: {
  host: string;
  shopperToken: string;
  accountId: string;
  accountToken: string;
}): Promise<{
  canonicalAccountId: string;
  canonicalAccountName?: string;
} | null> {
  try {
    const url = `${input.host}/v2/accounts/${encodeURIComponent(input.accountId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.shopperToken}`,
        [EP_ACCOUNT_TOKEN_HEADER]: input.accountToken,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as
      | { data?: { id?: string; name?: string } }
      | null;
    const id = body?.data?.id;
    if (typeof id !== "string" || !id) return null;
    const name = body?.data?.name;
    return {
      canonicalAccountId: id,
      canonicalAccountName: typeof name === "string" ? name : undefined,
    };
  } catch {
    return null;
  }
}

function jsonError(code: string, status: number, message: string): Response {
  return new Response(JSON.stringify({ error: code, code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function noSessionError(): Response {
  return jsonError(
    "no_session",
    401,
    "No EP session — call /ep/anonymous first to bootstrap."
  );
}

function noAccountMemberError(): Response {
  return jsonError(
    "no_account_member",
    401,
    "No account member is signed in."
  );
}

/**
 * The session as the account endpoints must read it: an expired credential is
 * a lapse, not a credential. Without this the endpoints would send a dead
 * token to Elastic Path and report its rejection as an outage, while every
 * read path states the lapse as a fact.
 */
function sessionWithLapseApplied(session: any): any {
  return applyAccountLapse(session, Math.floor(Date.now() / 1000));
}

/**
 * The account credential the session may re-mint from: the selected account's
 * token, or the anchor held while none is selected. A member who belongs to no
 * account holds neither, and re-authenticating is the only way back.
 */
function heldAccountCredential(session: any): string | null {
  const account = session?.epAccount as EpAccountSlot | undefined;
  if (account?.token) return account.token;
  const anchor = session?.epAnchorToken as EpAnchorTokenSlot | undefined;
  return anchor?.token ?? null;
}

/**
 * Writes the login's outcome onto the envelope. One account is a selection;
 * several are an anchor and a choice left to the shopper; none is a member who
 * is signed in and permanently unscoped.
 */
function applyLoginOutcome(session: any, minted: EpAccountTokenPage): any {
  const { memberId, entries, total } = minted;
  if (total === 1 && entries.length === 1) {
    return selectAccount(session, { memberId, account: entries[0] });
  }
  if (entries.length > 0) {
    return holdAnchorToken(session, {
      memberId,
      anchor: { token: entries[0].token, expires: entries[0].expires },
    });
  }
  return identifyMember(session, memberId);
}

/**
 * Whether the shopper was already acting for an organisation when the
 * transition began. What the resolver is told about the transition follows
 * from this one question.
 */
function heldAnAccountBefore(priorSession: any): boolean {
  return Boolean(priorSession?.epAccount || priorSession?.epLapsedAccount);
}

/**
 * Whether the cart in hand belongs to an identity that is not the one now
 * signing in. A cart built before anyone signed in belongs to whoever is
 * signing in; a cart held under any account, or by a different member, does
 * not — including a member of no organisation at all, who still holds a cart
 * nobody else may inherit.
 */
function cartBelongsToSomeoneElse(
  priorSession: any,
  memberId: string
): boolean {
  if (heldAnAccountBefore(priorSession)) return true;
  const priorMember = priorSession?.epMemberId;
  return typeof priorMember === "string" && priorMember !== memberId;
}

/**
 * Which transition this is, in the vocabulary CONTEXT.md sets: an account
 * switch changes the selected account *without re-authenticating*.
 *
 * So authenticating is always a login, however many accounts come back; and
 * choosing an account while acting for none — the tail of a sign-in, or a
 * shopper picking one up again after deselecting — is an arrival rather than a
 * switch, because there is no account being left.
 */
function triggerFor(
  priorSession: any,
  reauthenticated: boolean
): EpSessionCartTrigger {
  if (reauthenticated) return "login";
  return heldAnAccountBefore(priorSession) ? "accountSwitch" : "login";
}

/**
 * The cart the transition may offer as the guest cart: the one in hand, and
 * only when it is this shopper's own. A cart held under an account belongs to
 * that account, and a cart held by another member belongs to them.
 */
function guestCartBefore(
  priorSession: any,
  memberId: string
): string | null {
  if (cartBelongsToSomeoneElse(priorSession, memberId)) return null;
  const cartId = priorSession?.epCartId;
  return typeof cartId === "string" && cartId ? cartId : null;
}

function accountLapsedError(): Response {
  return jsonError(
    "account_lapsed",
    401,
    "The account credential ran out and cannot be re-minted. Sign in again."
  );
}

function shopperTokenFailure(err: unknown): Response {
  console.error(`[ep-commerce] epPlugin: ${(err as Error)?.message ?? err}`);
  return jsonError(
    "shopper_token_mint_failed",
    502,
    "Elastic Path refused the shopper token request."
  );
}

function accountTokenFailure(err: unknown): Response {
  if (err instanceof EpAccountTokenError) {
    return jsonError(err.code, err.status, err.message);
  }
  return jsonError(
    "account_token_mint_failed",
    502,
    (err as Error)?.message ?? "Elastic Path rejected the account-token call."
  );
}

/** The older shape, where the caller supplied a credential it minted itself. */
interface LegacyAccountLoginRequest {
  epMemberId: string;
  epAccountId: string;
  epAccountToken: string;
  epAccountExpires: string | number;
  email?: string;
  name?: string;
}

export function epPlugin(options: EpPluginOptions): BetterAuthPlugin {
  // One discovery per auth instance. The realm and its profiles are store
  // configuration, so re-reading them on every sign-in buys nothing.
  let discoveredProfile: Promise<string> | null = null;

  function passwordProfileId(host: string, implicitToken: string) {
    if (options.passwordProfileId) {
      return Promise.resolve(options.passwordProfileId);
    }
    if (!discoveredProfile) {
      discoveredProfile = discoverPasswordProfileId({ host, implicitToken });
      discoveredProfile.catch(() => {
        discoveredProfile = null;
      });
    }
    return discoveredProfile;
  }

  /**
   * An account switch invalidates any checkout in flight: it was priced and
   * addressed for the account being left.
   */
  function tearDownCheckoutSession(ctx: any): void {
    ctx.setCookie(CHECKOUT_SESSION_COOKIE_NAME, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
    });
  }

  /**
   * Chooses the session cart for a transition that ended with an account
   * selected, and returns the envelope carrying the outcome. The pointer is
   * always rewritten — cleared, then set — so a cart the previous identity
   * held cannot survive the swap.
   */
  async function applySessionCart(
    session: any,
    input: {
      priorSession: any;
      account: EpAccountSlot;
      memberId: string;
      reauthenticated: boolean;
    }
  ): Promise<any> {
    const ctx: EpTransitionCtx = {
      accessToken: session.epAccessToken,
      host: session.epHost,
      clientId: session.epClientId,
      accountId: input.account.id,
      accountToken: input.account.token,
    };
    const cartId = await resolveSessionCart({
      resolver: options.sessionCartResolver,
      trigger: triggerFor(input.priorSession, input.reauthenticated),
      guestCartId: guestCartBefore(input.priorSession, input.memberId),
      ctx,
    });
    const cleared = clearSessionCart(session);
    return cartId ? setSessionCart(cleared, cartId) : cleared;
  }

  return {
    id: "ep",
    endpoints: {
      epAnonymous: createAuthEndpoint(
        "/ep/anonymous",
        { method: "POST" },
        async (ctx) => {
          const { clientId, host } = await resolveConfigFor(options);
          let tokenData: EpAnonymousTokenResponse;
          try {
            tokenData = await mintAnonymousEpToken(clientId, host);
          } catch (err) {
            return shopperTokenFailure(err);
          }
          const snap = buildAnonymousSnapshot(tokenData, clientId, host);
          await setSessionCookie(ctx, snap as any);
          return ctx.json(epIdentityPayload("signInAnonymously", snap));
        }
      ),

      epRefresh: createAuthEndpoint(
        "/ep/refresh",
        { method: "POST" },
        async (ctx) => {
          const { clientId, host } = await resolveConfigFor(options);
          let tokenData: EpAnonymousTokenResponse;
          try {
            tokenData = await mintAnonymousEpToken(clientId, host);
          } catch (err) {
            return shopperTokenFailure(err);
          }

          const existing = await readExistingSession(ctx);
          if (!existing || !existing.user || !existing.session) {
            // No valid prior session — behave like /ep/anonymous.
            const snap = buildAnonymousSnapshot(tokenData, clientId, host);
            await setSessionCookie(ctx, snap as any);
            return ctx.json(epIdentityPayload("refresh", snap));
          }

          // Preserve identity (id, userId, etc.); rotate EP fields only.
          const now = Math.floor(Date.now() / 1000);
          const session = applyAccountLapse(
            {
              ...existing.session,
              updatedAt: new Date(),
              expiresAt: envelopeExpiresAt(now),
              epAccessToken: tokenData.access_token,
              epClientId: clientId,
              epHost: host,
              epExpires: tokenData.expires,
            },
            now
          );
          const snap = { user: existing.user, session };
          await setSessionCookie(ctx, snap as any);
          return ctx.json(epIdentityPayload("refresh", snap));
        }
      ),

      epAccountLogin: createAuthEndpoint(
        "/ep/account/login",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing?.user || !existing?.session) return noSessionError();

          const body = ((ctx.body as any) ?? {}) as Partial<
            EpAccountLoginRequest & LegacyAccountLoginRequest
          >;
          const { username, password } = body;

          // The credential shape: the package signs the member in itself, so
          // no Elastic Path credential ever passes through the browser. The
          // token shape below is the older contract, kept until the breaking
          // release retires it.
          if (typeof username === "string" && typeof password === "string") {
            const host = existing.session.epHost;
            const implicitToken = existing.session.epAccessToken;
            let minted;
            try {
              minted = await mintAccountTokens({
                host,
                implicitToken,
                credential: {
                  passwordProfileId: await passwordProfileId(
                    host,
                    implicitToken
                  ),
                  username,
                  password,
                },
              });
            } catch (err) {
              return accountTokenFailure(err);
            }

            const user = {
              ...existing.user,
              email: username,
              name: typeof body.name === "string" ? body.name : username,
              updatedAt: new Date(),
            };
            // The identity changed, so any checkout in flight was priced and
            // addressed for the shopper who is no longer the one here.
            tearDownCheckoutSession(ctx);

            let session: any = applyLoginOutcome(
              { ...existing.session, updatedAt: new Date() },
              minted
            );
            // Only a selection reaches the resolver: with no account there is
            // no credential to list account carts with and no `accountId` to
            // hand it.
            if (session.epAccount) {
              session = await applySessionCart(session, {
                priorSession: existing.session,
                account: session.epAccount,
                memberId: minted.memberId,
                reauthenticated: true,
              });
            } else if (
              cartBelongsToSomeoneElse(existing.session, minted.memberId)
            ) {
              // Nothing to resolve, but the cart in hand is not this
              // shopper's. Leaving it would hand the next member to sign in
              // on this browser the previous one's cart, and would then offer
              // it as theirs at their first selection.
              session = clearSessionCart(session);
            }

            await setSessionCookie(ctx, { session, user } as any);
            return ctx.json(
              epIdentityPayload("login", {
                user,
                session,
                accounts: toAccountRoster(minted.entries),
                total: minted.total,
              })
            );
          }

          const { epMemberId, epAccountId, epAccountToken, epAccountExpires } =
            body;
          const accountExpires = parseEpExpires(epAccountExpires);

          if (
            typeof epMemberId !== "string" ||
            !epMemberId ||
            typeof epAccountId !== "string" ||
            typeof epAccountToken !== "string" ||
            accountExpires === null
          ) {
            return jsonError(
              "invalid_input",
              400,
              "Body must include { username, password }, or the older " +
                "{ epMemberId, epAccountId, epAccountToken, epAccountExpires } " +
                "from EP /v2/account-members/tokens. epAccountExpires may be " +
                "ISO-8601 or epoch seconds."
            );
          }

          // Verify the supplied account token against EP before persisting.
          // Without this the endpoint trusts whatever the caller sent, so
          // any user with a session cookie could claim arbitrary epAccountId
          // and any storefront authorizing on session.user.epAccountId would
          // leak data. Issue #280.
          const verified = await verifyEpAccountToken({
            host: existing.session.epHost,
            shopperToken: existing.session.epAccessToken,
            accountId: epAccountId,
            accountToken: epAccountToken,
          });
          if (!verified) {
            return jsonError(
              "invalid_account_token",
              401,
              "EP rejected the supplied account token. Re-mint via /v2/account-members/tokens."
            );
          }

          // Upgrade the user record. Keep the same id/createdAt; switch
          // email + name to the real account values so downstream readers
          // can distinguish "real shopper" from "anonymous" via the
          // @anonymous.local sentinel.
          const user = {
            ...existing.user,
            email:
              typeof body.email === "string" ? body.email : existing.user.email,
            name: typeof body.name === "string" ? body.name : existing.user.name,
            updatedAt: new Date(),
          };

          tearDownCheckoutSession(ctx);

          const selected = selectAccount(
            { ...existing.session, updatedAt: new Date() },
            {
              memberId: epMemberId,
              account: {
                id: verified.canonicalAccountId,
                name: verified.canonicalAccountName,
                token: epAccountToken,
                expires: accountExpires,
              },
            }
          );
          const session = await applySessionCart(selected, {
            priorSession: existing.session,
            account: selected.epAccount!,
            memberId: epMemberId,
            reauthenticated: true,
          });

          await setSessionCookie(ctx, { session, user } as any);
          // The legacy shape, which no client method can reach.
          return ctx.json({ user, session });
        }
      ),

      epAccountRoster: createAuthEndpoint(
        "/ep/account/roster",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing?.user || !existing?.session) return noSessionError();

          if (typeof existing.session.epMemberId !== "string") {
            return noAccountMemberError();
          }

          const session = sessionWithLapseApplied(existing.session);
          const accountToken = heldAccountCredential(session);
          if (!accountToken) {
            if (session.epLapsedAccount) return accountLapsedError();
            // A member who belongs to no account holds no credential and has
            // an empty roster. That is an answer, not a failure.
            return ctx.json(
              epIdentityPayload("roster", { accounts: [], total: 0 })
            );
          }

          const body = ((ctx.body as any) ?? {}) as EpAccountRosterRequest;
          try {
            const page = await mintAccountTokens({
              host: session.epHost,
              implicitToken: session.epAccessToken,
              credential: { accountToken },
              limit: body.limit,
              offset: body.offset,
            });
            return ctx.json(
              epIdentityPayload("roster", {
                accounts: toAccountRoster(page.entries),
                total: page.total,
              })
            );
          } catch (err) {
            return accountTokenFailure(err);
          }
        }
      ),

      epAccountSelect: createAuthEndpoint(
        "/ep/account/select",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing?.user || !existing?.session) return noSessionError();

          const lapsed = sessionWithLapseApplied(existing.session);
          const current = lapsed.epAccount as EpAccountSlot | undefined;
          const memberId = lapsed.epMemberId;
          if (typeof memberId !== "string" || !memberId) {
            return noAccountMemberError();
          }

          const { accountId = null } = ((ctx.body as any) ??
            {}) as Partial<EpSelectAccountRequest>;
          if (accountId !== null && typeof accountId !== "string") {
            return jsonError(
              "invalid_input",
              400,
              "Body must include { accountId: string } to select, or { accountId: null } to deselect."
            );
          }

          // Selecting what is already selected changes nothing, so it must not
          // cost the shopper their checkout or their cart.
          if (accountId !== null && current?.id === accountId) {
            return ctx.json(epIdentityPayload("selectAccount", { user: existing.user, session: existing.session }));
          }

          const base: any = clearSessionCart({
            ...lapsed,
            updatedAt: new Date(),
          });

          if (accountId === null) {
            if (!current) {
              return ctx.json(
                epIdentityPayload("selectAccount", {
                  user: existing.user,
                  session: existing.session,
                })
              );
            }
            // Deselecting has no fallible step; the credential is demoted
            // rather than dropped, so the shopper can select again.
            tearDownCheckoutSession(ctx);
            const session = holdAnchorToken(base, {
              memberId,
              anchor: { token: current.token, expires: current.expires },
            });
            await setSessionCookie(ctx, {
              session,
              user: existing.user,
            } as any);
            return ctx.json(epIdentityPayload("selectAccount", { user: existing.user, session }));
          }

          const accountToken = heldAccountCredential(lapsed);
          if (!accountToken) {
            if (lapsed.epLapsedAccount) return accountLapsedError();
            // A member of no account has nothing to re-mint from, so an
            // account granted since they signed in costs them a re-login.
            return jsonError(
              "no_account_credential",
              401,
              "This member belonged to no account when they signed in, so there is no credential to select with. Sign in again."
            );
          }

          // Re-mint first. It is the only step that can fail, so a failure
          // leaves the shopper exactly where they were.
          let found;
          try {
            found = await findAccountToken({
              host: lapsed.epHost,
              implicitToken: lapsed.epAccessToken,
              accountToken,
              accountId,
            });
          } catch (err) {
            return accountTokenFailure(err);
          }
          if (!found.entry) {
            return jsonError(
              "account_not_found",
              404,
              `This member belongs to no account ${accountId}.`
            );
          }

          tearDownCheckoutSession(ctx);
          const session = await applySessionCart(
            selectAccount(base, {
              memberId: found.memberId,
              account: found.entry,
            }),
            {
              priorSession: existing.session,
              account: found.entry,
              memberId: found.memberId,
              reauthenticated: false,
            }
          );
          await setSessionCookie(ctx, { session, user: existing.user } as any);
          return ctx.json(epIdentityPayload("selectAccount", { user: existing.user, session }));
        }
      ),

      epAccountRoll: createAuthEndpoint(
        "/ep/account/roll",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing?.user || !existing?.session) return noSessionError();

          const current = existing.session.epAccount as
            | EpAccountSlot
            | undefined;
          const now = Math.floor(Date.now() / 1000);
          if (!accountNeedsRoll(current ?? null, now)) {
            return ctx.json(epIdentityPayload("rollAccount", { user: existing.user, session: existing.session }));
          }

          let found;
          try {
            found = await findAccountToken({
              host: existing.session.epHost,
              implicitToken: existing.session.epAccessToken,
              accountToken: current!.token,
              accountId: current!.id,
            });
          } catch {
            // A failed roll is not a failed request. The token still has time
            // on it, and if it runs out the lapse states that as a fact.
            return ctx.json(epIdentityPayload("rollAccount", { user: existing.user, session: existing.session }));
          }
          if (!found.entry) {
            return ctx.json(epIdentityPayload("rollAccount", { user: existing.user, session: existing.session }));
          }

          const session = selectAccount(
            { ...existing.session, updatedAt: new Date() },
            { memberId: found.memberId, account: found.entry }
          );
          await setSessionCookie(ctx, { session, user: existing.user } as any);
          return ctx.json(epIdentityPayload("rollAccount", { user: existing.user, session }));
        }
      ),

      epAccountLogout: createAuthEndpoint(
        "/ep/account/logout",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing?.user || !existing?.session) {
            return jsonError("no_session", 401, "Nothing to log out.");
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
          // The cart pointer goes with the shopper. Left behind, the next
          // person on this browser inherits the previous one's cart.
          const session = clearSessionCart(
            clearAccount({ ...existing.session, updatedAt: new Date() })
          );

          await setSessionCookie(ctx, { session, user } as any);
          return ctx.json(epIdentityPayload("logout", { user, session }));
        }
      ),

      epCart: createAuthEndpoint(
        "/ep/cart",
        { method: "POST" },
        async (ctx) => {
          const existing = await readExistingSession(ctx);
          if (!existing?.user || !existing?.session) return noSessionError();

          const { cartId } = ((ctx.body as any) ??
            {}) as Partial<EpSetCartRequest>;
          if (!cartId || typeof cartId !== "string") {
            return jsonError(
              "invalid_input",
              400,
              "Body must include { cartId: string }."
            );
          }

          const session = setSessionCart(
            { ...existing.session, updatedAt: new Date() },
            cartId
          );
          const snap = { user: existing.user, session };
          await setSessionCookie(ctx, snap as any);
          return ctx.json(epIdentityPayload("setCart", snap));
        }
      ),
    },
  };
}
