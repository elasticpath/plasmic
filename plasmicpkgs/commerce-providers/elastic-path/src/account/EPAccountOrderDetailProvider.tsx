/** EPAccountOrderDetailProvider — publishes one order of the selected organisation. */

import {
  DataProvider,
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { epIdentityErrorCode } from "../identity/client";
import type { EpAccountOrderDetail } from "../identity/operations";
import { useEpIdentity } from "../identity/useEpIdentity";
import { Registerable } from "../registerable";
import { useCanvasPreviewState } from "../utils/canvas-preview-state";
import { MOCK_ACCOUNT_ORDER_DETAILS } from "../utils/design-time-data";
import type {
  AccountContext,
  AccountOrderDetailData,
  AccountOrderDetailPreviewState,
} from "./types";

const NO_MEMBER = "No account member is signed in.";
const NO_SELECTED = "No organisation is selected.";
const LAPSED =
  "The account credential ran out and cannot be re-minted. Sign in again.";
const READ_FAILED = "Elastic Path rejected the account-order read.";
const UNREACHABLE = "Elastic Path was unreachable.";

/**
 * Same hyphenated-UUID rule as the account-order reader. The browser sends
 * only the lowercase form, and anything else is not requested.
 */
const CANONICAL_ORDER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REPRESENTATIVE = MOCK_ACCOUNT_ORDER_DETAILS[0];

export interface EPAccountOrderDetailProviderActions {
  retry(): void;
}

interface EPAccountOrderDetailProviderProps {
  children?: React.ReactNode;
  className?: string;
  orderId?: string;
  previewState?: AccountOrderDetailPreviewState;
}

type DetailView = {
  status: AccountOrderDetailData["status"];
  error: AccountOrderDetailData["error"];
  order: EpAccountOrderDetail | null;
};

const LOADING: DetailView = { status: "loading", error: null, order: null };
const NOT_FOUND: DetailView = { status: "not-found", error: null, order: null };

type CommittedDetail = {
  key: string;
  requestId: number;
  view: DetailView;
};

type InflightRequest = {
  key: string;
  requestId: number;
};

type DetailSnapshot = {
  inEditor: boolean;
  status: DetailView["status"];
  errorCode: string | null;
  canRetry: boolean;
};

function normalizeOrderId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!CANONICAL_ORDER_ID.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function readyView(order: EpAccountOrderDetail): DetailView {
  return { status: "ready", error: null, order };
}

function errorView(code: string, message: string): DetailView {
  return { status: "error", error: { code, message }, order: null };
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

function errorViewForKey(key: string): DetailView {
  if (key.startsWith("lapsed:")) return errorView("account_lapsed", LAPSED);
  if (key === "member-only") return errorView("no_selected_account", NO_SELECTED);
  return errorView("no_account_member", NO_MEMBER);
}

function readFailureView(err: unknown): DetailView {
  const code = epIdentityErrorCode(err);
  if (code === "account_order_not_found") return NOT_FOUND;
  if (code && err instanceof Error && err.message) return errorView(code, err.message);
  return errorView("account_orders_read_failed", UNREACHABLE);
}

function previewDetail(
  preview: AccountOrderDetailPreviewState | "auto",
  orderId: string | undefined
): DetailView {
  if (preview === "loading") return LOADING;
  if (preview === "not-found") return NOT_FOUND;
  if (preview === "error") {
    return errorView("account_orders_read_failed", READ_FAILED);
  }
  if (preview === "noSelectedAccount") {
    return errorView("no_selected_account", NO_SELECTED);
  }
  if (preview === "lapsed") return errorView("account_lapsed", LAPSED);
  if (preview === "ready") return readyView(REPRESENTATIVE);
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return readyView(REPRESENTATIVE);
  }
  const normalized = normalizeOrderId(orderId);
  const match = normalized
    ? MOCK_ACCOUNT_ORDER_DETAILS.find((order) => order.id === normalized)
    : undefined;
  return match ? readyView(match) : NOT_FOUND;
}

export const epAccountOrderDetailProviderMeta: CodeComponentMeta<EPAccountOrderDetailProviderProps> =
  {
    name: "plasmic-commerce-ep-account-order-detail-provider",
    displayName: "EP Account Order Detail Provider",
    description:
      "Publishes one order of the selected organisation as `$ctx.currentAccountOrder` and `$ctx.accountOrderDetailData` (`status`: `loading | ready | not-found | error`, `error`). Set Order ID from a route, query param, or `$ctx.currentAccountOrder.id` outside this component. `currentAccountOrder` is the detail only while status is ready, and null otherwise. A normal Studio button calls retry after a failed read. Studio Preview State uses sample orders and does not read the shopper's order. Place inside an EP Account Provider.",
    props: {
      orderId: {
        type: "string",
        displayName: "Order ID",
        description:
          "The order to read. A blank or non-UUID id publishes not-found and does not call Elastic Path. The same id with different capitalisation or surrounding spaces is one read.",
      },
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-order-item-list",
          },
        ],
      },
      previewState: {
        type: "choice",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Ready", value: "ready" },
          { label: "Not found", value: "not-found" },
          { label: "Loading", value: "loading" },
          { label: "Error", value: "error" },
          { label: "No selected account", value: "noSelectedAccount" },
          { label: "Lapsed account", value: "lapsed" },
        ],
        defaultValue: "auto",
        displayName: "Preview State",
        advanced: true,
        description:
          "Studio only. Auto with a blank Order ID shows a sample order with a product line and a shipping line. Auto with a sample order id shows that sample, including an itemless order. Auto with any other nonblank id shows not-found. Explicit states replace auto. Retry does not read an order on the canvas. Published pages ignore this and follow the selected account.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountOrderDetailProvider",
    parentComponentName: "plasmic-commerce-ep-account-provider",
    refActions: {
      retry: {
        displayName: "Retry",
        description:
          "Read this order again after Elastic Path rejected the read. Does not change the order or the selected organisation. No-op while loading or ready, when the order was not found, for a signed-out, unselected, or lapsed account, and in the Studio canvas.",
        argTypes: [],
      },
    },
  };

export const EPAccountOrderDetailProvider = React.forwardRef<
  EPAccountOrderDetailProviderActions,
  EPAccountOrderDetailProviderProps
>(function EPAccountOrderDetailProvider(props, ref) {
  const { children, className, orderId, previewState } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const preview = useCanvasPreviewState(previewState);
  const account = useSelector("account") as AccountContext | undefined;
  const identity = useEpIdentity();
  const requestId = useRef(0);
  const navLock = useRef(false);
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const [orderKey, setOrderKey] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [committed, setCommitted] = useState<CommittedDetail | null>(null);
  const [inflight, setInflight] = useState<InflightRequest | null>(null);
  const commitDetail = useCallback((next: CommittedDetail) => {
    setCommitted(next);
  }, []);

  const normalizedId = normalizeOrderId(orderId);
  const nextOrderKey = normalizedId ?? "invalid";
  const settledKey = !account
    ? "no-account-member"
    : account.isLoading
      ? null
      : settledAccountKey(account);

  let visibleAccount = accountKey;
  let visibleOrder = orderKey;
  let dropCommit = false;
  if (!inEditor && settledKey != null && settledKey !== accountKey) {
    setAccountKey(settledKey);
    setCommitted(null);
    dropCommit = true;
    visibleAccount = settledKey;
  }
  if (!inEditor && nextOrderKey !== orderKey) {
    setOrderKey(nextOrderKey);
    setCommitted(null);
    dropCommit = true;
    visibleOrder = nextOrderKey;
  }

  const requestKey = `${visibleAccount}|${visibleOrder}|${retryNonce}`;

  useEffect(() => {
    navLock.current = false;
  });

  useEffect(() => {
    if (inEditor) return;
    if (accountKey == null || orderKey == null) return;

    const id = ++requestId.current;
    const key = `${accountKey}|${orderKey}|${retryNonce}`;

    if (!accountKey.startsWith("selected:")) {
      setInflight(null);
      commitDetail({
        key,
        requestId: id,
        view: errorViewForKey(accountKey),
      });
      return () => {
        requestId.current += 1;
      };
    }

    if (orderKey === "invalid") {
      setInflight(null);
      commitDetail({ key, requestId: id, view: NOT_FOUND });
      return () => {
        requestId.current += 1;
      };
    }

    setInflight({ key, requestId: id });
    let cancelled = false;
    identity.accountOrder({ id: orderKey }).then(
      (result) => {
        if (cancelled || id !== requestId.current) return;
        setInflight(null);
        commitDetail({
          key,
          requestId: id,
          view: readyView(result),
        });
      },
      (err: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setInflight(null);
        commitDetail({
          key,
          requestId: id,
          view: readFailureView(err),
        });
      }
    );
    return () => {
      cancelled = true;
      requestId.current += 1;
    };
  }, [inEditor, accountKey, orderKey, retryNonce, identity, commitDetail]);

  const accountLoading = !!account?.isLoading;
  const awaitingCurrentRequest =
    inflight != null &&
    inflight.key === requestKey &&
    committed?.requestId !== inflight.requestId;
  const selectedAndInvalid =
    !accountLoading &&
    visibleAccount != null &&
    visibleAccount.startsWith("selected:") &&
    visibleOrder === "invalid";
  const pending = selectedAndInvalid ? NOT_FOUND : LOADING;
  const view = inEditor
    ? previewDetail(preview, orderId)
    : dropCommit ||
        accountLoading ||
        committed?.key !== requestKey ||
        awaitingCurrentRequest
      ? pending
      : committed.view;

  const snapshot = useRef<DetailSnapshot>({
    inEditor,
    status: view.status,
    errorCode: view.error?.code ?? null,
    canRetry: false,
  });
  const errorCode = view.error?.code ?? null;
  snapshot.current = {
    inEditor,
    status: view.status,
    errorCode,
    canRetry:
      !inEditor &&
      view.status === "error" &&
      errorCode === "account_orders_read_failed" &&
      visibleAccount != null &&
      visibleAccount.startsWith("selected:") &&
      visibleOrder !== "invalid",
  };

  const retry = useCallback(() => {
    const snap = snapshot.current;
    if (snap.inEditor || navLock.current || !snap.canRetry) return;
    navLock.current = true;
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  useImperativeHandle(ref, () => ({ retry }), [retry]);

  const data: AccountOrderDetailData = {
    status: view.status,
    error: view.error,
  };
  const order = view.status === "ready" ? view.order : null;

  return (
    <DataProvider name="accountOrderDetailData" data={data}>
      <DataProvider name="currentAccountOrder" data={order}>
        <div className={className} data-ep-account-order-detail-provider="">
          {children}
        </div>
      </DataProvider>
    </DataProvider>
  );
});

export function registerEPAccountOrderDetailProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountOrderDetailProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountOrderDetailProvider,
    customMeta ?? epAccountOrderDetailProviderMeta
  );
}
