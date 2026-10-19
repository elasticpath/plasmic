/**
 * Who a checkout's order is for. A shopper with a selected account (its token
 * and id in the handler context) checks out for that account; anyone else
 * checks out as a guest. The checkout session fixes the account when it is
 * created, so every order it creates (pay, a held 3DS order, resume, a free
 * order) is for the account the shopper chose, and pay refuses once the
 * shopper's selection is no longer that account. The account and the member
 * come only from the server-side session, never from the request.
 */
import type {
  CheckoutAccount,
  CheckoutSession,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
} from "./types";
import { createLogger } from "../../utils/logger";

const log = createLogger("CheckoutAccount");

export function selectedAccount(
  ctx: Pick<SessionHandlerContext, "accountToken" | "accountId" | "accountMemberId">
): CheckoutAccount | null {
  if (!ctx.accountToken || !ctx.accountId) return null;
  return {
    id: ctx.accountId,
    ...(ctx.accountMemberId ? { memberId: ctx.accountMemberId } : {}),
  };
}

function sameAccount(a: CheckoutAccount | null, b: CheckoutAccount | null): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && (a.memberId ?? null) === (b.memberId ?? null);
}

/**
 * 409 `ACCOUNT_CHANGED` when the shopper's selected account is not the one
 * the checkout session was created for. The session is dropped, so the next
 * checkout starts for the shopper as they are now. Null when it still matches.
 */
export async function refuseChangedAccount(
  req: SessionRequest,
  ctx: SessionHandlerContext,
  session: CheckoutSession
): Promise<SessionResponse | null> {
  if (sameAccount(session.account ?? null, selectedAccount(ctx))) return null;
  log.warn("Selected account changed during checkout; pay refused", {
    sessionId: session.id,
  } as Record<string, unknown>);
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
