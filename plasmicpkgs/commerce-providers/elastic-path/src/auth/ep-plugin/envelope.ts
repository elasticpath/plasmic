export const ENVELOPE_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

export const EP_ACCOUNT_TOKEN_HEADER =
  "EP-Account-Management-Authentication-Token";

/**
 * Re-mint the account token once it has less than this left. It is the
 * implicit token's own fixed lifetime — the one interval the platform already
 * forces on this package — rather than a number chosen here.
 */
export const ACCOUNT_ROLL_THRESHOLD_SECONDS = 3600;

export function envelopeExpiresAt(nowSeconds: number): Date {
  return new Date((nowSeconds + ENVELOPE_LIFETIME_SECONDS) * 1000);
}

export interface EpAccountSlot {
  id: string;
  name?: string;
  token: string;
  expires: number;
}

export interface EpAnchorTokenSlot {
  token: string;
  expires: number;
}

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

export function parseEpExpires(isoOrEpochSeconds: unknown): number | null {
  if (typeof isoOrEpochSeconds === "number") {
    return Number.isFinite(isoOrEpochSeconds)
      ? Math.floor(isoOrEpochSeconds)
      : null;
  }
  if (typeof isoOrEpochSeconds !== "string" || !isoOrEpochSeconds) return null;
  const parsed = Date.parse(isoOrEpochSeconds);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

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

export function selectAccount<T extends object>(
  session: T,
  input: { memberId: string; account: EpAccountSlot }
): WithAccountFields<T> {
  const next = withoutAccountSlots(session);
  next.epMemberId = input.memberId;
  next.epAccount = input.account;
  return next;
}

export function identifyMember<T extends object>(
  session: T,
  memberId: string
): WithAccountFields<T> {
  const next = withoutAccountSlots(session);
  next.epMemberId = memberId;
  return next;
}

export function holdAnchorToken<T extends object>(
  session: T,
  input: { memberId: string; anchor: EpAnchorTokenSlot }
): WithAccountFields<T> {
  const next = withoutAccountSlots(session);
  next.epMemberId = input.memberId;
  next.epAnchorToken = input.anchor;
  return next;
}

export function clearAccount<T extends object>(
  session: T
): WithAccountFields<T> {
  const next = withoutAccountSlots(session);
  delete next.epMemberId;
  return next;
}

interface EpSessionCartField {
  epCartId?: string;
}

export function setSessionCart<T extends object>(
  session: T,
  cartId: string
): T & EpSessionCartField {
  return { ...session, epCartId: cartId };
}

export function clearSessionCart<T extends object>(
  session: T
): T & EpSessionCartField {
  const next = { ...session } as T & EpSessionCartField;
  delete next.epCartId;
  return next;
}

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

export function accountNeedsRoll(
  account: EpAccountSlot | null | undefined,
  nowSeconds: number
): boolean {
  if (!account) return false;
  const remaining = account.expires - nowSeconds;
  return remaining > 0 && remaining < ACCOUNT_ROLL_THRESHOLD_SECONDS;
}

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

export function accountTokenHeaders(
  auth: { accountToken?: string } | null | undefined
): Record<string, string> {
  return auth?.accountToken
    ? { [EP_ACCOUNT_TOKEN_HEADER]: auth.accountToken }
    : {};
}
