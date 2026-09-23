/**
 * Which cart the envelope points at after an identity transition (#536).
 *
 * Elastic Path performs no automatic merge, and its own copy operation adds
 * quantities together, so ten saved plus two added becomes twelve. Which cart
 * wins is merchant policy, so the package offers a seam and a default that
 * cannot silently destroy or inflate what the shopper just built.
 *
 * Consumers cannot build this themselves: the package never hands a cart id to
 * the browser, and `GET /v2/carts` returns ids ADR-0003 refuses to release.
 */
import { accountTokenHeaders } from "./envelope";
import { ACCOUNT_PAGE_LIMIT_MAX, readError } from "./account-tokens";
import { withEpSession } from "../../ep-server-functions/session-context";
import type { EpCtx } from "../../ep-server-functions/build-ep-ctx";

/** One of the account's own carts, as Elastic Path lists them. */
export interface EpAccountCart {
  id: string;
  name?: string;
  description?: string;
  /** ISO-8601. Elastic Path moves it on a successful write, never on a read. */
  updatedAt?: string;
  createdAt?: string;
}

/**
 * Whether the shopper is arriving, or moving between organisations.
 *
 * `"accountSwitch"` is the narrow one, and means exactly what CONTEXT.md says:
 * the selected organisation changed *without re-authenticating*. So it implies
 * one was already selected, and therefore that `guestCartId` is null.
 *
 * `"login"` is everything else — authenticating, however many organisations
 * come back, and choosing one while acting for none, whether that is the tail
 * of a sign-in or picking one up again after deselecting.
 */
export type EpSessionCartTrigger = "login" | "accountSwitch";

export interface EpSessionCartResolverInput {
  trigger: EpSessionCartTrigger;
  /**
   * The cart the shopper is looking at, owned by no account. Null at a switch:
   * carrying a cart out of the account that owns it would append the new
   * account to it and take the old account's prices into checkout.
   */
  guestCartId: string | null;
  /** The carts already on the account being entered, most recent first. */
  accountCarts: readonly EpAccountCart[];
  /** The account the shopper now acts for. */
  accountId: string;
}

/**
 * An object rather than a bare id, so a later verdict is a new union member
 * instead of a breaking change.
 */
export interface EpSessionCartVerdict {
  /** Must be one of the ids the resolver was offered. */
  keep: string;
}

/**
 * Chooses the session cart at a login or an account switch.
 *
 * It runs inside the EP session scope under the shopper's new identity, so
 * `ep.*` server functions and raw fetches both work, and a policy like
 * take-the-higher-quantity is expressible without the package inventing a
 * merge language. Decide first and write last, or make the writes safe to
 * repeat: a partial write is the resolver's own to undo. There is no package
 * timeout — the host platform's request timeout is the bound.
 */
export type EpSessionCartResolver = (
  input: EpSessionCartResolverInput
) => Promise<EpSessionCartVerdict> | EpSessionCartVerdict;

/**
 * The scope a transition runs the resolver in. The account is always selected
 * by then, so its credential is not optional the way `EpCtx` leaves it.
 *
 * `cartId` is deliberately absent: which cart is the session cart is the
 * question being answered, so a resolver names the cart it means rather than
 * letting `ep.*` default to one.
 */
export type EpTransitionCtx = Omit<EpCtx, "cartId"> & {
  accountId: string;
  accountToken: string;
};

function report(message: string, detail?: unknown): void {
  const line = `[ep-commerce] sessionCartResolver: ${message}`;
  if (detail === undefined) {
    console.error(line);
    return;
  }
  console.error(line, detail instanceof Error ? detail.message : detail);
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Keep the guest cart — the one the shopper is looking at when they click log
 * in. With none, adopt the account cart written to most recently.
 */
function pickDefaultSessionCart(
  input: EpSessionCartResolverInput
): string | null {
  if (input.guestCartId) return input.guestCartId;
  return input.accountCarts[0]?.id ?? null;
}

/**
 * One page of the account's carts, most recently updated first. Line items are
 * not fetched: that is one request per cart on every login, and most resolvers
 * read none.
 *
 * One page, not all of them. Elastic Path ignores `sort` on this endpoint —
 * measured: `sort=updated_at` and `sort=-updated_at` return the same order —
 * so recency is decided here, over what the page holds. An account holding
 * more than `ACCOUNT_PAGE_LIMIT_MAX` carts inside the store's expiry window
 * can therefore have a more recent cart this never sees. Paging every login
 * to close that costs a request per page for every shopper.
 */
async function listAccountCarts(ctx: EpTransitionCtx): Promise<EpAccountCart[]> {
  const response = await fetch(
    `${ctx.host}/v2/carts?page[limit]=${ACCOUNT_PAGE_LIMIT_MAX}`,
    {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        ...accountTokenHeaders(ctx),
      },
    }
  );
  if (!response.ok) {
    throw new Error(
      `Elastic Path rejected the account cart list: ${await readError(response)}`
    );
  }
  const body = (await response.json()) as {
    data?: {
      id?: string;
      name?: string;
      description?: string;
      meta?: { timestamps?: { created_at?: string; updated_at?: string } };
    }[];
  };
  const carts: EpAccountCart[] = [];
  for (const record of body.data ?? []) {
    if (typeof record.id !== "string" || !record.id) continue;
    const timestamps = record.meta?.timestamps;
    carts.push({
      id: record.id,
      name: typeof record.name === "string" ? record.name : undefined,
      description:
        typeof record.description === "string" ? record.description : undefined,
      createdAt: timestamps?.created_at,
      updatedAt: timestamps?.updated_at,
    });
  }
  // Elastic Path ignores `sort` on this endpoint — measured: `sort=updated_at`
  // and `sort=-updated_at` come back in the same order — so the order the
  // resolver sees is decided here, and `accountCarts[0]` is the most recently
  // updated one.
  return carts.sort(
    (a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt)
  );
}

/**
 * Adds the account to the winning cart's account set, so the shopper finds it
 * again on their next visit. Association is discoverability, not access
 * control (ADR-0003), so a failure costs enumeration and nothing else.
 */
async function associateCartWithAccount(
  ctx: EpTransitionCtx,
  cartId: string
): Promise<void> {
  const response = await fetch(
    `${ctx.host}/v2/carts/${encodeURIComponent(cartId)}/relationships/accounts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        "Content-Type": "application/json",
        ...accountTokenHeaders(ctx),
      },
      body: JSON.stringify({
        data: [{ type: "account", id: ctx.accountId }],
      }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Elastic Path rejected the cart association: ${await readError(response)}`
    );
  }
}

export interface ResolveSessionCartInput {
  resolver?: EpSessionCartResolver;
  trigger: EpSessionCartTrigger;
  /** Null when the cart in hand belongs to the account being left. */
  guestCartId: string | null;
  /** Built from the envelope after the swap, so it carries the new identity. */
  ctx: EpTransitionCtx;
}

/**
 * Runs the transition: list the account's carts, let the resolver choose and
 * act, then associate the winner. The loser is never deleted — Elastic Path
 * collects it after the store's expiry window, and deleting a cart the shopper
 * never asked to delete cannot be undone.
 *
 * Nothing here can fail the sign-in. A wrong cart costs the shopper a re-add;
 * a merchant bug in a merge rule must not lock them out of their account.
 */
export async function resolveSessionCart(
  input: ResolveSessionCartInput
): Promise<string | null> {
  const { ctx } = input;

  let accountCarts: EpAccountCart[] = [];
  try {
    accountCarts = await listAccountCarts(ctx);
  } catch (err) {
    report("could not list the account's carts", err);
  }

  const resolverInput: EpSessionCartResolverInput = {
    trigger: input.trigger,
    guestCartId: input.guestCartId,
    accountCarts,
    accountId: ctx.accountId,
  };

  let chosen = pickDefaultSessionCart(resolverInput);

  if (input.resolver) {
    try {
      const verdict = await withEpSession(ctx, () =>
        input.resolver!(resolverInput)
      );
      const keep = (verdict as EpSessionCartVerdict | null | undefined)?.keep;
      if (typeof keep !== "string" || !keep) {
        report("named no cart to keep; keeping the default");
      } else if (
        keep !== input.guestCartId &&
        !accountCarts.some((candidate) => candidate.id === keep)
      ) {
        report(
          `named ${keep}, which it was not offered; keeping the default`
        );
      } else {
        chosen = keep;
      }
    } catch (err) {
      report("failed; keeping the default", err);
    }
  }

  if (!chosen) return null;

  const alreadyOnTheAccount = accountCarts.some(
    (candidate) => candidate.id === chosen
  );
  if (!alreadyOnTheAccount) {
    try {
      await associateCartWithAccount(ctx, chosen);
    } catch (err) {
      report("could not associate the chosen cart with the account", err);
    }
  }

  return chosen;
}
