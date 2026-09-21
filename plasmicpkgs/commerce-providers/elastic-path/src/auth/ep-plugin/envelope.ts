/**
 * The shopper envelope's account identity (ADR-0003).
 *
 * The envelope holds an **account member** — the authenticated person —
 * and a **selected account** — the organisation they act for — as two
 * independent facts. Authentication is the member; selection is the
 * account, and a member belonging to no organisation is signed in.
 *
 * `epAccount` and `epAnchorToken` are mutually exclusive slots rather
 * than one nullable selection. Only `epAccount.token` ever reaches the
 * account-management header, so a session with no account selected
 * cannot send one — structure, not discipline.
 *
 * Every writer lives here. Nothing else touches the account fields, so
 * the mutual exclusion holds without any call site remembering it.
 */

/**
 * The envelope's lifetime, in seconds. Carts expire seven days after
 * their last update, and the envelope holds the only handle to a live
 * cart — an envelope shorter than the cart it points at loses the
 * basket while Elastic Path still has it. Better-auth's `cookieCache`
 * default is 300 seconds.
 */
export const ENVELOPE_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

export const EP_ACCOUNT_TOKEN_HEADER =
  "EP-Account-Management-Authentication-Token";

/** When an envelope minted or rolled at `nowSeconds` runs out. */
export function envelopeExpiresAt(nowSeconds: number): Date {
  return new Date((nowSeconds + ENVELOPE_LIFETIME_SECONDS) * 1000);
}

/** The selected organisation, with the credential that acts for it. */
export interface EpAccountSlot {
  id: string;
  name?: string;
  token: string;
  /** Epoch seconds. */
  expires: number;
}

/**
 * The credential held while no account is selected. A member with
 * several organisations and none chosen would otherwise hold no Elastic
 * Path account credential at all, and re-minting the roster needs one.
 */
export interface EpAnchorTokenSlot {
  token: string;
  /** Epoch seconds. */
  expires: number;
}

/** A selection whose credential ran out, stated rather than inferred. */
export interface EpLapsedAccount {
  id: string;
  name?: string;
}

export interface EpEnvelopeAccountFields {
  epMemberId?: string;
  epAccount?: EpAccountSlot;
  epAnchorToken?: EpAnchorTokenSlot;
  epLapsedAccount?: EpLapsedAccount;
}

/**
 * Normalises an account-credential expiry to epoch seconds. Elastic
 * Path's `/v2/account-members/tokens` returns ISO-8601; the envelope
 * stores seconds so comparisons need no date parsing.
 */
export function parseEpExpires(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.floor(value) : null;
  }
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/**
 * The envelope is better-auth's session record with our fields added,
 * so every writer takes the record it was handed and returns the same
 * type plus the account fields.
 */
type WithAccountFields<T> = T & EpEnvelopeAccountFields;

function withoutAccountSlots<T extends object>(
  session: T
): WithAccountFields<T> {
  const next = { ...session } as WithAccountFields<T>;
  delete next.epAccount;
  delete next.epAnchorToken;
  delete next.epLapsedAccount;
  return next;
}

/** Selects an organisation. Releases the anchor and any prior lapse. */
export function selectAccount<T extends object>(
  session: T,
  input: { memberId: string; account: EpAccountSlot }
): WithAccountFields<T> {
  const next = withoutAccountSlots(session);
  next.epMemberId = input.memberId;
  next.epAccount = input.account;
  return next;
}

/** Holds an anchor credential with no organisation selected. */
export function holdAnchorToken<T extends object>(
  session: T,
  input: { memberId: string; anchor: EpAnchorTokenSlot }
): WithAccountFields<T> {
  const next = withoutAccountSlots(session);
  next.epMemberId = input.memberId;
  next.epAnchorToken = input.anchor;
  return next;
}

/** Signs the member out, leaving the shopper's own credential in place. */
export function clearAccount<T extends object>(
  session: T
): WithAccountFields<T> {
  const next = withoutAccountSlots(session);
  delete next.epMemberId;
  return next;
}

/**
 * Turns an expired credential into a stated lapse. The member stays
 * signed in; the organisation's credential goes, and the shopper can be
 * told which organisation they lost rather than quietly seeing list
 * prices.
 */
export function applyAccountLapse<T extends object>(
  session: T,
  nowSeconds: number
): WithAccountFields<T> {
  const current = session as WithAccountFields<T>;
  const account = current.epAccount;
  if (account && account.expires <= nowSeconds) {
    const next = withoutAccountSlots(session);
    next.epLapsedAccount = { id: account.id, name: account.name };
    return next;
  }
  const anchor = current.epAnchorToken;
  if (anchor && anchor.expires <= nowSeconds) {
    return withoutAccountSlots(session);
  }
  return current;
}

/**
 * The envelope's account identity, read for the storefront. The anchor
 * token is deliberately not part of the reading: it is a credential for
 * re-minting the roster, not an identity anything downstream acts on.
 */
export function readEnvelopeAccount(session: object | null | undefined): {
  memberId: string | undefined;
  account: EpAccountSlot | null;
  lapsedAccount: EpLapsedAccount | null;
} {
  const envelope = (session ?? {}) as EpEnvelopeAccountFields;
  return {
    memberId: envelope.epMemberId,
    account: envelope.epAccount ?? null,
    lapsedAccount: envelope.epLapsedAccount ?? null,
  };
}

/**
 * The account-management header for an Elastic Path call. The only
 * input is a selected account's token, so a session holding an anchor
 * — or nothing — sends no account header.
 */
export function accountTokenHeaders(
  auth: { accountToken?: string } | null | undefined
): Record<string, string> {
  return auth?.accountToken
    ? { [EP_ACCOUNT_TOKEN_HEADER]: auth.accountToken }
    : {};
}
