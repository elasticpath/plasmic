/** EPAccountOrdersProvider — publishes `$ctx.accountOrders`. */

import {
  DataProvider,
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { epIdentityErrorCode } from "../identity/client";
import type { EpAccountOrderResult } from "../identity/operations";
import { useEpIdentity } from "../identity/useEpIdentity";
import { Registerable } from "../registerable";
import { useCanvasPreviewState } from "../utils/canvas-preview-state";
import { MOCK_ACCOUNT_ORDERS } from "../utils/design-time-data";
import type {
  AccountContext,
  AccountOrderHistoryContext,
  AccountOrderPreviewState,
} from "./types";

const NO_MEMBER = "No account member is signed in.";
const NO_SELECTED = "No organisation is selected.";
const LAPSED =
  "The account credential ran out and cannot be re-minted. Sign in again.";
const READ_FAILED = "Elastic Path rejected the account-order read.";

const LOADING_HISTORY: AccountOrderHistoryContext = {
  status: "loading",
  orders: [],
  total: 0,
  error: null,
};

const EMPTY_PREVIEW: AccountOrderHistoryContext = {
  status: "empty",
  orders: [],
  total: 0,
  error: null,
};

const FIXTURE_HISTORY: AccountOrderHistoryContext = {
  status: "ready",
  orders: MOCK_ACCOUNT_ORDERS,
  total: MOCK_ACCOUNT_ORDERS.length,
  error: null,
};

function errorHistory(
  code: string,
  message: string
): AccountOrderHistoryContext {
  return {
    status: "error",
    orders: [],
    total: 0,
    error: { code, message },
  };
}

const PREVIEW_HISTORY: Record<
  Exclude<AccountOrderPreviewState, "auto">,
  AccountOrderHistoryContext
> = {
  withOrders: FIXTURE_HISTORY,
  empty: EMPTY_PREVIEW,
  loading: LOADING_HISTORY,
  error: errorHistory("account_orders_read_failed", READ_FAILED),
  noSelectedAccount: errorHistory("no_selected_account", NO_SELECTED),
  lapsed: errorHistory("account_lapsed", LAPSED),
};

function previewHistory(
  preview: AccountOrderPreviewState | "auto"
): AccountOrderHistoryContext {
  if (preview === "auto") return FIXTURE_HISTORY;
  return PREVIEW_HISTORY[preview] ?? FIXTURE_HISTORY;
}

function settledAccountKey(account: AccountContext): string {
  switch (account.state) {
    case "selected":
      return `selected:${account.selectedAccount?.id ?? ""}`;
    case "lapsed":
      return `lapsed:${account.lapsedAccount?.id ?? ""}`;
    case "memberOnly":
      return "member-only";
    case "anonymous":
      return "anonymous";
  }
}

function renderAccountKey(account: AccountContext | undefined): string {
  if (!account) return "no-account-member";
  if (account.isLoading) return "loading";
  return settledAccountKey(account);
}

function errorHistoryForKey(key: string): AccountOrderHistoryContext {
  if (key.startsWith("lapsed:")) return errorHistory("account_lapsed", LAPSED);
  if (key === "member-only") {
    return errorHistory("no_selected_account", NO_SELECTED);
  }
  return errorHistory("no_account_member", NO_MEMBER);
}

function historyFromResult(
  result: EpAccountOrderResult
): AccountOrderHistoryContext {
  return {
    status: result.orders.length === 0 ? "empty" : "ready",
    orders: result.orders,
    total: result.total,
    error: null,
  };
}

function readFailureHistory(err: unknown): AccountOrderHistoryContext {
  const code = epIdentityErrorCode(err) ?? "account_orders_read_failed";
  const message =
    err instanceof Error && err.message ? err.message : READ_FAILED;
  return errorHistory(code, message);
}

interface EPAccountOrdersProviderProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: AccountOrderPreviewState;
}

type CommittedHistory = {
  key: string;
  history: AccountOrderHistoryContext;
};

export const epAccountOrdersProviderMeta: CodeComponentMeta<EPAccountOrdersProviderProps> =
  {
    name: "plasmic-commerce-ep-account-orders-provider",
    displayName: "EP Account Orders Provider",
    description:
      "Publishes the selected organisation's order history as `$ctx.accountOrders`. Place inside an EP Account Provider. Studio Preview State uses sample orders and does not read the shopper's orders.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-order-list",
          },
        ],
      },
      previewState: {
        type: "choice",
        options: [
          { label: "Auto", value: "auto" },
          { label: "With orders", value: "withOrders" },
          { label: "Empty", value: "empty" },
          { label: "Loading", value: "loading" },
          { label: "Error", value: "error" },
          { label: "No selected account", value: "noSelectedAccount" },
          { label: "Lapsed account", value: "lapsed" },
        ],
        defaultValue: "auto",
        displayName: "Preview State",
        advanced: true,
        description:
          "Studio only. `auto` shows two sample orders. The other values force a state on the canvas. The canvas does not read order history. Published pages ignore this and follow the selected account.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountOrdersProvider",
    parentComponentName: "plasmic-commerce-ep-account-provider",
  };

export function EPAccountOrdersProvider(props: EPAccountOrdersProviderProps) {
  const { children, className, previewState } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const preview = useCanvasPreviewState(previewState);
  const account = useSelector("account") as AccountContext | undefined;
  const identity = useEpIdentity();
  const requestId = useRef(0);
  const heldKeyRef = useRef<string | null>(null);
  const [committed, setCommitted] = useState<CommittedHistory | null>(null);
  const commitHistory = useCallback((next: CommittedHistory) => {
    setCommitted(next);
  }, []);

  if (!account) {
    heldKeyRef.current = "no-account-member";
  } else if (!account.isLoading) {
    heldKeyRef.current = settledAccountKey(account);
  }
  const effectKey = heldKeyRef.current;
  const renderKey = renderAccountKey(account);

  useEffect(() => {
    if (inEditor) return;
    if (effectKey == null) return;

    const id = ++requestId.current;
    const key = effectKey;

    if (!key.startsWith("selected:")) {
      commitHistory({ key, history: errorHistoryForKey(key) });
      return () => {
        requestId.current += 1;
      };
    }

    let cancelled = false;
    identity.accountOrders().then(
      (result) => {
        if (cancelled || id !== requestId.current) return;
        commitHistory({ key, history: historyFromResult(result) });
      },
      (err: unknown) => {
        if (cancelled || id !== requestId.current) return;
        commitHistory({ key, history: readFailureHistory(err) });
      }
    );
    return () => {
      cancelled = true;
      requestId.current += 1;
    };
  }, [inEditor, effectKey, identity, commitHistory]);

  const history = inEditor
    ? previewHistory(preview)
    : committed?.key === renderKey
      ? committed.history
      : LOADING_HISTORY;

  return (
    <DataProvider name="accountOrders" data={history}>
      <div className={className} data-ep-account-orders-provider="">
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPAccountOrdersProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountOrdersProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountOrdersProvider,
    customMeta ?? epAccountOrdersProviderMeta
  );
}
