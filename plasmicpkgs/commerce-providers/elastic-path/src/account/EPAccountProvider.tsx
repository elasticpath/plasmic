/**
 * EPAccountProvider — publishes `$ctx.account` to descendants.
 *
 * Owns the boundary between the shopper envelope and consuming components.
 * Maps the browser-readable session identity (and roster) into `$ctx.account`
 * without tokens, expiry, or auth internals. Gate and Field only read
 * `$ctx.account`.
 */

import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useState } from "react";
import { Registerable } from "../registerable";
import {
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_BY_PREVIEW_STATE,
} from "../utils/design-time-data";
import { createLogger } from "../utils/logger";
import type {
  AccountContext,
  AccountPreviewState,
  AccountRef,
  AccountRoster,
  AccountState,
} from "./types";

const log = createLogger("EPAccountProvider");

const AUTH_BASE_PATH = "/api/ep";

const EMPTY_ROSTER: AccountRoster = { accounts: [], total: 0 };

interface EPAccountProviderProps {
  children?: React.ReactNode;
  previewState?: AccountPreviewState;
  className?: string;
}

/** Browser-readable get-session identity. Credentials are redacted server-side. */
export type ShopperIdentitySession = {
  epMemberId?: unknown;
  epAccount?: { id?: unknown; name?: unknown } | null;
  epLapsedAccount?: { id?: unknown; name?: unknown } | null;
};

export function toAccountRef(
  slot: { id?: unknown; name?: unknown } | null | undefined
): AccountRef | null {
  if (!slot || typeof slot.id !== "string" || !slot.id) return null;
  const ref: AccountRef = { id: slot.id };
  if (typeof slot.name === "string") ref.name = slot.name;
  return ref;
}

export function deriveAccountState(input: {
  accountMember: { id: string } | null;
  selectedAccount: AccountRef | null;
  lapsedAccount: AccountRef | null;
}): AccountState {
  if (!input.accountMember) return "anonymous";
  if (input.lapsedAccount) return "lapsed";
  if (input.selectedAccount) return "selected";
  return "memberOnly";
}

export function normalizeAccountRoster(body: unknown): AccountRoster {
  if (!body || typeof body !== "object") return EMPTY_ROSTER;
  const raw = body as { accounts?: unknown; total?: unknown };
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts
        .map((entry) =>
          toAccountRef(entry as { id?: unknown; name?: unknown })
        )
        .filter((entry): entry is AccountRef => entry != null)
    : [];
  const total =
    typeof raw.total === "number" && Number.isFinite(raw.total)
      ? raw.total
      : accounts.length;
  return { accounts, total };
}

export function accountContextFromSession(
  session: ShopperIdentitySession | null | undefined,
  roster?: AccountRoster | null
): AccountContext {
  const memberId =
    typeof session?.epMemberId === "string" && session.epMemberId
      ? session.epMemberId
      : null;
  const accountMember = memberId ? { id: memberId } : null;
  const selectedAccount = toAccountRef(session?.epAccount);
  const lapsedAccount = toAccountRef(session?.epLapsedAccount);
  return {
    state: deriveAccountState({
      accountMember,
      selectedAccount,
      lapsedAccount,
    }),
    accountMember,
    selectedAccount,
    accountRoster: roster ?? EMPTY_ROSTER,
    lapsedAccount,
  };
}

export function previewAccountContext(
  previewState: AccountPreviewState
): AccountContext {
  if (previewState === "auto") {
    return MOCK_ACCOUNT_BY_PREVIEW_STATE.selected;
  }
  return (
    MOCK_ACCOUNT_BY_PREVIEW_STATE[previewState] ??
    MOCK_ACCOUNT_BY_PREVIEW_STATE.selected
  );
}

async function loadAccountRoster(): Promise<AccountRoster> {
  try {
    const res = await fetch(`${AUTH_BASE_PATH}/ep/account/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });
    if (!res.ok) return EMPTY_ROSTER;
    return normalizeAccountRoster(await res.json());
  } catch {
    return EMPTY_ROSTER;
  }
}

export async function loadLiveAccountContext(): Promise<AccountContext | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${AUTH_BASE_PATH}/get-session`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      session?: ShopperIdentitySession | null;
    } | null;
    const mapped = accountContextFromSession(payload?.session);
    if (!mapped.accountMember) return mapped;
    const accountRoster = await loadAccountRoster();
    return { ...mapped, accountRoster };
  } catch {
    return null;
  }
}

function hasMemberIdentity(account: AccountContext): boolean {
  return account.accountMember != null;
}

export const epAccountProviderMeta: CodeComponentMeta<EPAccountProviderProps> =
  {
    name: "plasmic-commerce-ep-account-provider",
    displayName: "EP Account Provider",
    description:
      "Exposes the current shopper's account identity as `$ctx.account` to descendants. Wrap account gates, fields, and later account experiences. Preview State selects sample identity in Studio; published pages use the shopper session.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-gate",
            props: { when: "authenticated" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-account-field",
            props: { field: "selectedAccount.name" },
          },
        ],
      },
      previewState: {
        type: "choice",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Anonymous", value: "anonymous" },
          { label: "Member only", value: "memberOnly" },
          { label: "Account selected", value: "selected" },
          { label: "Lapsed account", value: "lapsed" },
        ],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Studio only. Force a sample account identity so Gates and Fields can be composed. `auto` uses live session identity when a member is present, otherwise the selected-account fixture. Ignored on the published page.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountProvider",
  };

export function EPAccountProvider(props: EPAccountProviderProps) {
  const { children, previewState = "auto", className } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const forcePreview = inEditor && previewState !== "auto";
  const [live, setLive] = useState<AccountContext | null>(null);

  useEffect(() => {
    if (forcePreview) {
      setLive(null);
      return;
    }
    let cancelled = false;
    loadLiveAccountContext().then((ctx) => {
      if (!cancelled) setLive(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [forcePreview]);

  const account = forcePreview
    ? previewAccountContext(previewState)
    : inEditor
    ? live && hasMemberIdentity(live)
      ? live
      : previewAccountContext("auto")
    : live ?? MOCK_ACCOUNT_ANONYMOUS;

  if (inEditor) {
    log.debug("Publishing account context", {
      previewState,
      state: account.state,
      live: !!live,
    });
  }

  return (
    <DataProvider name="account" data={account}>
      <div className={className} data-ep-account-provider="">
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPAccountProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPAccountProvider, customMeta ?? epAccountProviderMeta);
}
