/**
 * Elastic Path's account-member token call, and the discovery it needs.
 *
 * `POST /v2/account-members/tokens` mints one account-management token per
 * account the member belongs to. It takes either the member's password or an
 * account token they already hold, so the package can sign a member in and
 * later re-mint without ever storing a credential.
 *
 * The response is the account roster and the token list at once. Callers keep
 * the tokens on the server and hand the browser only `{ id, name }`.
 */
import { EP_ACCOUNT_TOKEN_HEADER, parseEpExpires } from "./envelope";

/** The platform rejects `page[limit]` above this, and defaults to 25. */
export const ACCOUNT_PAGE_LIMIT_MAX = 100;

export interface EpAccountTokenEntry {
  id: string;
  name?: string;
  token: string;
  expires: number;
}

export interface EpAccountTokenPage {
  memberId: string;
  entries: EpAccountTokenEntry[];
  total: number;
}

export type EpAccountCredential =
  | { passwordProfileId: string; username: string; password: string }
  | { accountToken: string };

export class EpAccountTokenError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "EpAccountTokenError";
    this.code = code;
    this.status = status;
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    errors?: { detail?: string; title?: string }[];
  } | null;
  const first = body?.errors?.[0];
  return first?.detail ?? first?.title ?? `HTTP ${response.status}`;
}

export function clampAccountPageLimit(limit: unknown): number {
  const asNumber = typeof limit === "number" ? limit : Number(limit);
  if (!Number.isFinite(asNumber) || asNumber < 1) return ACCOUNT_PAGE_LIMIT_MAX;
  return Math.min(Math.floor(asNumber), ACCOUNT_PAGE_LIMIT_MAX);
}

export function clampAccountPageOffset(offset: unknown): number {
  const asNumber = typeof offset === "number" ? offset : Number(offset);
  if (!Number.isFinite(asNumber) || asNumber < 0) return 0;
  return Math.floor(asNumber);
}

/**
 * Finds the password profile the token call requires.
 *
 * A realm may carry several profiles and a member's password belongs to
 * exactly one of them; the wrong one answers `400 authentication failed`,
 * which says nothing about the profile. Nothing in the profile record marks a
 * default, so an ambiguous realm is reported rather than guessed at — a guess
 * would send the member's password to a profile they do not belong to.
 */
export async function discoverPasswordProfileId(input: {
  host: string;
  implicitToken: string;
}): Promise<string> {
  const settings = await fetch(
    `${input.host}/v2/settings/account-authentication`,
    { headers: { Authorization: `Bearer ${input.implicitToken}` } }
  );
  if (!settings.ok) {
    throw new EpAccountTokenError(
      "password_profile_unresolved",
      502,
      `Elastic Path rejected the account-authentication settings read: ${await readError(settings)}`
    );
  }
  const settingsBody = (await settings.json()) as {
    data?: {
      relationships?: { authentication_realm?: { data?: { id?: string } } };
    };
  };
  const realm = settingsBody.data?.relationships?.authentication_realm?.data?.id;
  if (!realm) {
    throw new EpAccountTokenError(
      "password_profile_unresolved",
      502,
      "Elastic Path's account-authentication settings name no authentication realm."
    );
  }

  const profiles = await fetch(
    `${input.host}/v2/authentication-realms/${encodeURIComponent(realm)}/password-profiles`,
    { headers: { Authorization: `Bearer ${input.implicitToken}` } }
  );
  if (!profiles.ok) {
    throw new EpAccountTokenError(
      "password_profile_unresolved",
      502,
      `Elastic Path rejected the password-profile read: ${await readError(profiles)}`
    );
  }
  const profilesBody = (await profiles.json()) as {
    data?: { id?: string; name?: string }[];
  };
  const found = (profilesBody.data ?? []).filter(
    (profile): profile is { id: string; name?: string } =>
      typeof profile.id === "string" && profile.id.length > 0
  );

  if (found.length === 1) return found[0].id;
  if (found.length === 0) {
    throw new EpAccountTokenError(
      "password_profile_unresolved",
      502,
      `Authentication realm ${realm} has no password profile, so account members cannot sign in with a password.`
    );
  }
  const listed = found
    .map((profile) => `${profile.id}${profile.name ? ` (${profile.name})` : ""}`)
    .join(", ");
  throw new EpAccountTokenError(
    "password_profile_ambiguous",
    500,
    `Authentication realm ${realm} has ${found.length} password profiles — ${listed}. ` +
      "Pass `passwordProfileId` to createEpAuth to say which one members sign in against."
  );
}

/**
 * Mints one page of the member's account tokens.
 *
 * With a password this is the sign-in; with an account token it re-mints from
 * a credential the session already holds, which needs no password and returns
 * a fresh full window. Either way the response carries the whole roster, so
 * one call answers both "who is this" and "what may they buy for".
 */
export async function mintAccountTokens(input: {
  host: string;
  implicitToken: string;
  credential: EpAccountCredential;
  limit?: number;
  offset?: number;
}): Promise<EpAccountTokenPage> {
  const limit = clampAccountPageLimit(input.limit);
  const offset = clampAccountPageOffset(input.offset);
  const query = `page[limit]=${limit}&page[offset]=${offset}`;

  const credential = input.credential;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.implicitToken}`,
    "Content-Type": "application/json",
  };
  let data: Record<string, string>;
  let usingPassword: boolean;

  if ("passwordProfileId" in credential) {
    usingPassword = true;
    data = {
      type: "account_management_authentication_token",
      authentication_mechanism: "password",
      password_profile_id: credential.passwordProfileId,
      username: credential.username,
      password: credential.password,
    };
  } else {
    usingPassword = false;
    // The existing token rides in the header. In the body the call answers 400
    // on a derived internal id it never asked for.
    headers[EP_ACCOUNT_TOKEN_HEADER] = credential.accountToken;
    data = {
      type: "account_management_authentication_token",
      authentication_mechanism: "account_management_authentication_token",
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `${input.host}/v2/account-members/tokens?${query}`,
      { method: "POST", headers, body: JSON.stringify({ data }) }
    );
  } catch (err) {
    throw new EpAccountTokenError(
      "ep_unreachable",
      502,
      `Elastic Path was unreachable: ${(err as Error)?.message ?? err}`
    );
  }

  if (!response.ok) {
    const detail = await readError(response);
    if (usingPassword && response.status === 400) {
      throw new EpAccountTokenError(
        "invalid_credentials",
        401,
        `Elastic Path rejected the member's credentials: ${detail}`
      );
    }
    throw new EpAccountTokenError(
      "account_token_mint_failed",
      response.status === 401 ? 401 : 502,
      `Elastic Path rejected the account-token call: ${detail}`
    );
  }

  const body = (await response.json()) as {
    data?: {
      account_id?: string;
      account_name?: string;
      token?: string;
      expires?: string;
    }[];
    meta?: {
      account_member_id?: string;
      results?: { total?: number };
    };
  };

  const memberId = body.meta?.account_member_id;
  if (typeof memberId !== "string" || !memberId) {
    throw new EpAccountTokenError(
      "account_token_mint_failed",
      502,
      "Elastic Path's account-token response names no account member."
    );
  }

  const entries: EpAccountTokenEntry[] = [];
  for (const entry of body.data ?? []) {
    const expires = parseEpExpires(entry.expires);
    if (typeof entry.account_id !== "string" || !entry.account_id) continue;
    if (typeof entry.token !== "string" || !entry.token) continue;
    if (expires === null) continue;
    entries.push({
      id: entry.account_id,
      name:
        typeof entry.account_name === "string" ? entry.account_name : undefined,
      token: entry.token,
      expires,
    });
  }

  const reported = body.meta?.results?.total;
  const total =
    typeof reported === "number" && Number.isFinite(reported)
      ? reported
      : entries.length;

  return { memberId, entries, total };
}

/**
 * Walks the roster for one account's token.
 *
 * The target's token appears only on the page holding it and tokens never
 * reach the browser, so the walk happens here. Each page carries up to 100
 * tokens this discards — the price of the browser holding none.
 */
export async function findAccountToken(input: {
  host: string;
  implicitToken: string;
  accountToken: string;
  accountId: string;
}): Promise<{ memberId: string; entry: EpAccountTokenEntry | null }> {
  let offset = 0;
  let memberId = "";
  for (;;) {
    const page = await mintAccountTokens({
      host: input.host,
      implicitToken: input.implicitToken,
      credential: { accountToken: input.accountToken },
      limit: ACCOUNT_PAGE_LIMIT_MAX,
      offset,
    });
    memberId = page.memberId;
    const match = page.entries.find((entry) => entry.id === input.accountId);
    if (match) return { memberId, entry: match };
    offset += page.entries.length;
    if (page.entries.length === 0 || offset >= page.total) {
      return { memberId, entry: null };
    }
  }
}

/** The roster as the browser may see it — ids and names, never tokens. */
export function toAccountRoster(
  entries: readonly EpAccountTokenEntry[]
): { id: string; name?: string }[] {
  return entries.map((entry) => ({ id: entry.id, name: entry.name }));
}
