/** EPAccountOrdersProvider — publishes `$ctx.accountOrders`. */

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
import type {
  EpAccountOrder,
  EpAccountOrderPageInfo,
  EpAccountOrderPageResult,
  EpAccountOrderResult,
} from "../identity/operations";
import {
  EP_ACCOUNT_ORDER_PAGE_LIMIT_MAX,
  EP_ACCOUNT_ORDER_PAGE_OFFSET_MAX,
} from "../identity/operations";
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
const UNREACHABLE = "Elastic Path was unreachable.";
const INVALID_PAGE_SIZE = "Page size must be an integer from 1 to 100.";

const ACCOUNT_GATE_CODES = new Set([
  "no_session",
  "no_account_member",
  "no_selected_account",
  "account_lapsed",
]);

type PageConfig =
  | { mode: "full" }
  | { mode: "invalid" }
  | { mode: "page"; limit: number };

export interface EPAccountOrdersProviderActions {
  nextPage(): void;
  previousPage(): void;
  retryPage(): void;
}

function configuredPage(pageSize: number | null | undefined): PageConfig {
  if (pageSize == null) return { mode: "full" };
  if (
    typeof pageSize === "number" &&
    Number.isInteger(pageSize) &&
    pageSize >= 1 &&
    pageSize <= EP_ACCOUNT_ORDER_PAGE_LIMIT_MAX
  ) {
    return { mode: "page", limit: pageSize };
  }
  return { mode: "invalid" };
}

function sizeToken(config: PageConfig): string {
  return config.mode === "page" ? `page:${config.limit}` : config.mode;
}

function quietPage(limit: number, offset: number): EpAccountOrderPageInfo {
  return {
    limit,
    offset,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}

function loadingHistory(
  config: PageConfig,
  pageIndex: number
): AccountOrderHistoryContext {
  return {
    status: "loading",
    orders: [],
    total: 0,
    error: null,
    page:
      config.mode === "page"
        ? quietPage(config.limit, pageIndex * config.limit)
        : null,
  };
}

const EMPTY_PREVIEW: AccountOrderHistoryContext = {
  status: "empty",
  orders: [],
  total: 0,
  error: null,
  page: null,
};

const FIXTURE_HISTORY: AccountOrderHistoryContext = {
  status: "ready",
  orders: MOCK_ACCOUNT_ORDERS,
  total: MOCK_ACCOUNT_ORDERS.length,
  error: null,
  page: null,
};

function errorHistory(
  code: string,
  message: string,
  page: EpAccountOrderPageInfo | null = null
): AccountOrderHistoryContext {
  return {
    status: "error",
    orders: [],
    total: 0,
    error: { code, message },
    page,
  };
}

const INVALID_PAGE_HISTORY = errorHistory(
  "invalid_page_size",
  INVALID_PAGE_SIZE
);

function sampleOrder(n: number): EpAccountOrder {
  return {
    id: `sample-order-${n}`,
    order_number: String(1000 + n),
    status: n % 2 === 0 ? "processing" : "complete",
    payment: n % 2 === 0 ? "authorized" : "paid",
    shipping: n % 2 === 0 ? "unfulfilled" : "fulfilled",
    meta: {
      timestamps: { created_at: "2024-03-01T12:00:00Z" },
      display_price: {
        with_tax: {
          amount: 1000 * n,
          currency: "USD",
          formatted: `$${(10 * n).toFixed(2)}`,
          float_price: 10 * n,
        },
      },
    },
  };
}

function sampleWindow(
  limit: number,
  pageNumber: number,
  flags: Pick<EpAccountOrderPageInfo, "hasNextPage" | "hasPreviousPage">
): AccountOrderHistoryContext {
  const orders = Array.from({ length: limit }, (_, index) =>
    sampleOrder(pageNumber * limit + index + 1)
  );
  return {
    status: "ready",
    orders,
    total: orders.length,
    error: null,
    page: {
      limit,
      offset: pageNumber * limit,
      ...flags,
    },
  };
}

function previewHistory(
  preview: AccountOrderPreviewState | "auto",
  config: PageConfig
): AccountOrderHistoryContext {
  if (config.mode === "invalid") return INVALID_PAGE_HISTORY;
  const paged = config.mode === "page" ? config.limit : null;
  if (preview === "empty") {
    return paged == null
      ? EMPTY_PREVIEW
      : {
          status: "empty",
          orders: [],
          total: 0,
          error: null,
          page: quietPage(paged, 0),
        };
  }
  if (preview === "loading") {
    return loadingHistory(config.mode === "page" ? config : { mode: "full" }, 0);
  }
  if (preview === "error") {
    return errorHistory(
      "account_orders_read_failed",
      READ_FAILED,
      paged == null ? null : quietPage(paged, 0)
    );
  }
  if (preview === "noSelectedAccount") {
    return errorHistory("no_selected_account", NO_SELECTED);
  }
  if (preview === "lapsed") {
    return errorHistory("account_lapsed", LAPSED);
  }
  if (paged == null) return FIXTURE_HISTORY;
  if (preview === "middlePage") {
    return sampleWindow(paged, 1, { hasPreviousPage: true, hasNextPage: true });
  }
  if (preview === "lastPage") {
    return sampleWindow(paged, 2, { hasPreviousPage: true, hasNextPage: false });
  }
  return sampleWindow(paged, 0, { hasPreviousPage: false, hasNextPage: true });
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
    page: null,
  };
}

function historyFromPage(
  result: EpAccountOrderPageResult
): AccountOrderHistoryContext {
  const noRows = result.orders.length === 0;
  const terminalFirstPage =
    noRows && result.page.offset === 0 && !result.page.hasNextPage;
  return {
    status: terminalFirstPage ? "empty" : "ready",
    orders: result.orders,
    total: result.total,
    error: null,
    page: result.page,
  };
}

function readFailureHistory(err: unknown): AccountOrderHistoryContext {
  const code = epIdentityErrorCode(err);
  if (code && err instanceof Error && err.message) {
    return errorHistory(code, err.message);
  }
  return errorHistory("account_orders_read_failed", UNREACHABLE);
}

interface EPAccountOrdersProviderProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: AccountOrderPreviewState;
  pageSize?: number;
}

type CommittedHistory = {
  key: string;
  requestId: number;
  history: AccountOrderHistoryContext;
};

type InflightRequest = {
  key: string;
  requestId: number;
};

type PageSnapshot = {
  inEditor: boolean;
  config: PageConfig;
  status: AccountOrderHistoryContext["status"];
  page: EpAccountOrderPageInfo | null;
  pageIndex: number;
};

export const epAccountOrdersProviderMeta: CodeComponentMeta<EPAccountOrdersProviderProps> =
  {
    name: "plasmic-commerce-ep-account-orders-provider",
    displayName: "EP Account Orders Provider",
    description:
      "Publishes the selected organisation's order history as `$ctx.accountOrders`. Place inside an EP Account Provider. Leave Page Size empty for the full history. An integer from 1 to 100 reads one window. A normal Studio button calls nextPage, previousPage, or retryPage. Studio Preview State uses sample orders and does not read the shopper's orders.",
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
      pageSize: {
        type: "number",
        displayName: "Page Size",
        description:
          "Leave empty to load the full history. An integer from 1 to 100 loads one window and enables nextPage, previousPage, and retryPage. Any other value publishes invalid_page_size and does not read orders. total is the number of orders in the current result, not the size of the history. Page number is Math.floor($ctx.accountOrders.page.offset / $ctx.accountOrders.page.limit) + 1. There is no total page count.",
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
          { label: "First page", value: "firstPage" },
          { label: "Middle page", value: "middlePage" },
          { label: "Last page", value: "lastPage" },
        ],
        defaultValue: "auto",
        displayName: "Preview State",
        advanced: true,
        description:
          "Studio only. Without Page Size, auto shows two sample orders and the page states do the same. With a Page Size from 1 to 100, auto and first page show the first window, middle page shows the next, and last page shows a final window. An invalid Page Size publishes invalid_page_size and ignores Preview State. The canvas does not read order history. Published pages ignore this and follow the selected account.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountOrdersProvider",
    parentComponentName: "plasmic-commerce-ep-account-provider",
    refActions: {
      nextPage: {
        displayName: "Next page",
        description:
          "Read the next window when Page Size is set, the current page succeeded, and next is available. No-op while loading or failed, in the Studio canvas, and when next would pass offset 100000.",
        argTypes: [],
      },
      previousPage: {
        displayName: "Previous page",
        description:
          "Read the previous window when Page Size is set, the current page succeeded, and previous is available. No-op while loading or failed, and in the Studio canvas.",
        argTypes: [],
      },
      retryPage: {
        displayName: "Retry page",
        description:
          "Read the current window again after a failed page read. Does not change the page. No-op unless that read failed, and no-op for an invalid Page Size.",
        argTypes: [],
      },
    },
  };

export const EPAccountOrdersProvider = React.forwardRef<
  EPAccountOrdersProviderActions,
  EPAccountOrdersProviderProps
>(function EPAccountOrdersProvider(props, ref) {
  const { children, className, previewState, pageSize } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const preview = useCanvasPreviewState(previewState);
  const account = useSelector("account") as AccountContext | undefined;
  const identity = useEpIdentity();
  const requestId = useRef(0);
  const navLock = useRef(false);
  const [selectionKey, setSelectionKey] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [appliedSize, setAppliedSize] = useState<string | null>(null);
  const [committed, setCommitted] = useState<CommittedHistory | null>(null);
  const [inflight, setInflight] = useState<InflightRequest | null>(null);
  const commitHistory = useCallback((next: CommittedHistory) => {
    setCommitted(next);
  }, []);
  const config = configuredPage(pageSize);
  const token = sizeToken(config);

  const settledKey = !account
    ? "no-account-member"
    : account.isLoading
      ? null
      : settledAccountKey(account);
  let visibleSelection = selectionKey;
  let visibleIndex = pageIndex;
  let dropCommit = false;
  if (!inEditor && settledKey != null && settledKey !== selectionKey) {
    setSelectionKey(settledKey);
    setPageIndex(0);
    setCommitted(null);
    dropCommit = true;
    visibleSelection = settledKey;
    visibleIndex = 0;
  }
  if (!inEditor && token !== appliedSize) {
    setAppliedSize(token);
    setPageIndex(0);
    setCommitted(null);
    dropCommit = true;
    visibleIndex = 0;
  }

  const requestKey = `${visibleSelection}|${token}|${visibleIndex}|${retryNonce}`;

  useEffect(() => {
    navLock.current = false;
  });

  useEffect(() => {
    if (inEditor) return;
    if (selectionKey == null || appliedSize == null) return;
    const paging = configuredPage(pageSize);
    if (paging.mode === "invalid") return;

    const id = ++requestId.current;
    const key = `${selectionKey}|${appliedSize}|${pageIndex}|${retryNonce}`;

    if (!selectionKey.startsWith("selected:")) {
      setInflight(null);
      commitHistory({
        key,
        requestId: id,
        history: errorHistoryForKey(selectionKey),
      });
      return () => {
        requestId.current += 1;
      };
    }

    const offset =
      paging.mode === "page" ? pageIndex * paging.limit : 0;
    setInflight({ key, requestId: id });
    let cancelled = false;
    const request =
      paging.mode === "page"
        ? identity.accountOrderPage({ limit: paging.limit, offset })
        : identity.accountOrders();
    request.then(
      (result) => {
        if (cancelled || id !== requestId.current) return;
        setInflight(null);
        commitHistory({
          key,
          requestId: id,
          history:
            paging.mode === "page"
              ? historyFromPage(result as EpAccountOrderPageResult)
              : historyFromResult(result as EpAccountOrderResult),
        });
      },
      (err: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setInflight(null);
        const failure = readFailureHistory(err);
        const gate =
          failure.error != null && ACCOUNT_GATE_CODES.has(failure.error.code);
        commitHistory({
          key,
          requestId: id,
          history: {
            ...failure,
            page:
              paging.mode === "page" && !gate
                ? quietPage(paging.limit, offset)
                : null,
          },
        });
      }
    );
    return () => {
      cancelled = true;
      requestId.current += 1;
    };
  }, [
    inEditor,
    selectionKey,
    appliedSize,
    pageIndex,
    retryNonce,
    pageSize,
    identity,
    commitHistory,
  ]);

  const accountLoading = !!account?.isLoading;
  const awaitingCurrentRequest =
    inflight != null &&
    inflight.key === requestKey &&
    committed?.requestId !== inflight.requestId;
  const history = inEditor
    ? previewHistory(preview, config)
    : config.mode === "invalid"
      ? INVALID_PAGE_HISTORY
      : dropCommit ||
          accountLoading ||
          committed?.key !== requestKey ||
          awaitingCurrentRequest
        ? loadingHistory(config, visibleIndex)
        : committed.history;

  const snapshot = useRef<PageSnapshot>({
    inEditor,
    config,
    status: history.status,
    page: history.page,
    pageIndex: visibleIndex,
  });
  snapshot.current = {
    inEditor,
    config,
    status: history.status,
    page: history.page,
    pageIndex: visibleIndex,
  };

  const nextPage = useCallback(() => {
    const snap = snapshot.current;
    if (snap.inEditor || navLock.current) return;
    if (snap.config.mode !== "page") return;
    if (snap.status !== "ready") return;
    if (!snap.page?.hasNextPage) return;
    const nextOffset = (snap.pageIndex + 1) * snap.config.limit;
    if (nextOffset > EP_ACCOUNT_ORDER_PAGE_OFFSET_MAX) return;
    navLock.current = true;
    setPageIndex(snap.pageIndex + 1);
  }, []);

  const previousPage = useCallback(() => {
    const snap = snapshot.current;
    if (snap.inEditor || navLock.current) return;
    if (snap.config.mode !== "page") return;
    if (snap.status !== "ready") return;
    if (!snap.page?.hasPreviousPage) return;
    if (snap.pageIndex <= 0) return;
    navLock.current = true;
    setPageIndex(snap.pageIndex - 1);
  }, []);

  const retryPage = useCallback(() => {
    const snap = snapshot.current;
    if (snap.inEditor || navLock.current) return;
    if (snap.config.mode !== "page") return;
    if (snap.status !== "error" || snap.page == null) return;
    navLock.current = true;
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ nextPage, previousPage, retryPage }),
    [nextPage, previousPage, retryPage]
  );

  return (
    <DataProvider name="accountOrders" data={history}>
      <div className={className} data-ep-account-orders-provider="">
        {children}
      </div>
    </DataProvider>
  );
});

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
