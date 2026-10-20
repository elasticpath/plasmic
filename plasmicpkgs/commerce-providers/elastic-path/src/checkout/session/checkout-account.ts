/**
 * Who a checkout's order is for. A shopper with a selected account (its token
 * and id in the handler context) checks out for that account; anyone else
 * checks out as a guest. The checkout session fixes the account when it is
 * created, so every order it creates (pay, a held 3DS order, resume, a free
 * order) is for the account the shopper chose, and pay refuses once the
 * shopper's selection is no longer that account. The account and the member
 * come only from the server-side session, never from the request. A context
 * with only one of the token and the id is refused, never checked out as a
 * guest.
 */
import type { EpSession } from "../../auth/ep-plugin/create-ep-auth-better";
import type {
  CheckoutAccount,
  CheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "./types";
import { createLogger } from "../../utils/logger";

const log = createLogger("CheckoutAccount");

type AccountFields = Pick<
  SessionHandlerContext,
  "accountToken" | "accountId" | "accountMemberId"
>;

/** The shopper fields of `SessionHandlerContext` that `checkoutContextFromSession` sets. */
export type CheckoutSessionContext = Pick<
  SessionHandlerContext,
  | "shopperAccessToken"
  | "sessionCartId"
  | "accountToken"
  | "accountId"
  | "accountMemberId"
  | "locale"
  | "currency"
>;

/**
 * The shopper's checkout fields, all from one `getSession` result: the
 * shopper token, the session cart, the selected account (token and id), the
 * signed-in member, locale and currency. Spread it into the
 * `SessionHandlerContext`, so the account is never set by halves.
 */
export function checkoutContextFromSession(
  session:
    | (Pick<EpSession, "session" | "cart"> &
        Partial<Pick<EpSession, "locale" | "currency">>)
    | null
    | undefined
): CheckoutSessionContext {
  const envelope = session?.session ?? null;
  const account = envelope?.account ?? null;
  return {
    shopperAccessToken: envelope?.accessToken || undefined,
    sessionCartId: session?.cart?.id ?? undefined,
    accountToken: account?.token,
    accountId: account?.id,
    accountMemberId: account ? envelope?.memberId : undefined,
    locale: session?.locale,
    currency: session?.currency,
  };
}

const HALF_ACCOUNT =
  "accountToken and accountId must be set together for a selected account; set them with checkoutContextFromSession(session)";

function setByHalves(ctx: AccountFields): boolean {
  return !ctx.accountToken !== !ctx.accountId;
}

/**
 * The account the order is for; null for a guest. Throws when the context
 * has only one of `accountToken` and `accountId`.
 */
export function selectedAccount(ctx: AccountFields): CheckoutAccount | null {
  if (setByHalves(ctx)) throw new Error(`Checkout configuration: ${HALF_ACCOUNT}`);
  if (!ctx.accountToken || !ctx.accountId) return null;
  return {
    id: ctx.accountId,
    ...(ctx.accountMemberId ? { memberId: ctx.accountMemberId } : {}),
  };
}

/**
 * 500 `ACCOUNT_NOT_CONFIGURED` when the context has only one of
 * `accountToken` and `accountId`: the checkout cannot tell whether the order
 * is for an account, so it places none. Null when the context is whole.
 */
export function refuseHalfAccount(ctx: AccountFields): SessionResponse | null {
  if (!setByHalves(ctx)) return null;
  log.error(HALF_ACCOUNT);
  return {
    status: 500,
    body: {
      success: false,
      error: {
        message: "Checkout is not available right now. Please try again later.",
        code: "ACCOUNT_NOT_CONFIGURED",
      },
    },
  };
}

function sameAccount(a: CheckoutAccount | null, b: CheckoutAccount | null): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && (a.memberId ?? null) === (b.memberId ?? null);
}

/**
 * 409 `ACCOUNT_CHANGED` when the shopper's selected account is not the one
 * the checkout session was created for. The session is dropped, so the next
 * checkout starts for the shopper as they are now. 500
 * `ACCOUNT_NOT_CONFIGURED` for a context set by halves. Null when it still
 * matches.
 */
export async function refuseChangedAccount(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  session: CheckoutSession
): Promise<SessionResponse | null> {
  const halfAccount = refuseHalfAccount(ctx);
  if (halfAccount) return halfAccount;
  if (sameAccount(session.account ?? null, selectedAccount(ctx))) return null;
  log.warn("Selected account changed during checkout; pay refused", {
    sessionId: session.id,
  });
  let headers: Record<string, string> | undefined;
  try {
    headers = (await ctx.sessionStore.delete("current", req)).headers;
  } catch {
    /* the refusal stands; the next create replaces the session */
  }
  return {
    status: 409,
    body: {
      success: false,
      error: {
        message: "Your account changed during checkout. Please start checkout again.",
        code: "ACCOUNT_CHANGED",
      },
    },
    ...(headers ? { headers } : {}),
  };
}
