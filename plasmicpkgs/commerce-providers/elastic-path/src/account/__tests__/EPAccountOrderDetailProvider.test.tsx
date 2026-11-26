/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockAccountOrder = jest.fn();
const mockAccountOrders = jest.fn();
const mockAccountOrderPage = jest.fn();
const mockIdentity = {
  accountOrder: mockAccountOrder,
  accountOrders: mockAccountOrders,
  accountOrderPage: mockAccountOrderPage,
};

jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  const DataCtx = React.createContext({});
  return {
    DataProvider: ({ name, data, children }: any) => {
      const parent = React.useContext(DataCtx);
      const next = { ...parent, [name]: data };
      return React.createElement(
        DataCtx.Provider,
        { value: next },
        React.createElement(
          "div",
          {
            "data-testid": `data-provider-${name}`,
            "data-value": JSON.stringify(data),
          },
          children
        )
      );
    },
    useSelector: (key: string) => React.useContext(DataCtx)[key],
    usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
    repeatedElement: (_i: number, children: React.ReactNode) => children,
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

jest.mock("../../identity/useEpIdentity", () => ({
  useEpIdentity: () => mockIdentity,
}));

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { EpAccountOrderDetail } from "../../identity/operations";
import {
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_LAPSED,
  MOCK_ACCOUNT_MEMBER_ONLY,
  MOCK_ACCOUNT_ORDER_DETAIL,
  MOCK_ACCOUNT_ORDER_DETAIL_ITEMLESS,
  MOCK_ACCOUNT_SELECTED,
} from "../../utils/design-time-data";
import type {
  AccountContext,
  AccountOrderDetailData,
} from "../types";

const {
  EPAccountOrderDetailProvider,
  registerEPAccountOrderDetailProvider,
  epAccountOrderDetailProviderMeta,
} = require("../EPAccountOrderDetailProvider");

const ORDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const READ_FAILED = "Elastic Path rejected the account-order read.";
const UNREACHABLE = "Elastic Path was unreachable.";

function detail(id: string, items: EpAccountOrderDetail["items"] = []): EpAccountOrderDetail {
  return {
    id,
    order_number: id === ORDER ? "1001" : "1002",
    status: "complete",
    payment: "paid",
    shipping: "fulfilled",
    items,
  };
}

const product = detail(ORDER, [
  {
    id: "item-1",
    name: "Deck shoe",
    sku: "deck-shoe",
    quantity: 2,
    product_id: "prod-1",
    meta: {
      display_price: {
        with_tax: {
          unit: {
            amount: 250,
            currency: "USD",
            formatted: "$2.50",
            float_price: 2.5,
          },
          value: {
            amount: 500,
            currency: "USD",
            formatted: "$5.00",
            float_price: 5,
          },
        },
      },
    },
  },
]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function refusal(code: string, message: string): Error {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

function selected(id: string, patch: Partial<AccountContext> = {}): AccountContext {
  return {
    ...MOCK_ACCOUNT_SELECTED,
    state: "selected",
    isLoading: false,
    selectedAccount: { id, name: id },
    lapsedAccount: null,
    ...patch,
  };
}

function publishedData(): AccountOrderDetailData {
  const raw = screen
    .getByTestId("data-provider-accountOrderDetailData")
    .getAttribute("data-value");
  return JSON.parse(raw || "null");
}

function publishedOrder(): EpAccountOrderDetail | null {
  const nodes = screen.getAllByTestId("data-provider-currentAccountOrder");
  const raw = nodes[nodes.length - 1].getAttribute("data-value");
  return JSON.parse(raw || "null");
}

function Harness(props: {
  account?: AccountContext;
  orderId?: string;
  previewState?: string;
  className?: string;
  detailRef?: React.Ref<any>;
  outerOrder?: unknown;
  children?: React.ReactNode;
}) {
  const { DataProvider } = require("@plasmicapp/host");
  const provider = (
    <EPAccountOrderDetailProvider
      ref={props.detailRef}
      orderId={props.orderId}
      previewState={props.previewState as any}
      className={props.className}
    >
      {props.children}
    </EPAccountOrderDetailProvider>
  );
  const withAccount = (
    <DataProvider name="account" data={props.account}>
      {provider}
    </DataProvider>
  );
  if (props.outerOrder === undefined) return withAccount;
  return (
    <DataProvider name="currentAccountOrder" data={props.outerOrder}>
      {withAccount}
    </DataProvider>
  );
}

describe("EPAccountOrderDetailProvider", () => {
  beforeEach(() => {
    mockAccountOrder.mockReset();
    mockAccountOrders.mockReset();
    mockAccountOrderPage.mockReset();
    mockAccountOrder.mockResolvedValue(product);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("reads one order for a selected account and a canonical id", async () => {
    render(<Harness account={selected("acct-a")} orderId={`  ${ORDER.toUpperCase()}  `} />);
    await waitFor(() => expect(publishedData().status).toBe("ready"));
    expect(mockAccountOrder).toHaveBeenCalledTimes(1);
    expect(mockAccountOrder).toHaveBeenCalledWith({ id: ORDER });
    expect(mockAccountOrders).not.toHaveBeenCalled();
    expect(mockAccountOrderPage).not.toHaveBeenCalled();
    expect(publishedOrder()).toEqual(product);
    expect(publishedData().error).toBeNull();
  });

  it("stays ready when the order has no items", async () => {
    const empty = detail(ORDER, []);
    mockAccountOrder.mockResolvedValue(empty);
    render(<Harness account={selected("acct-a")} orderId={ORDER} />);
    await waitFor(() => expect(publishedData().status).toBe("ready"));
    expect(publishedOrder()).toEqual(empty);
    expect(publishedOrder()?.items).toEqual([]);
  });

  it.each(["", "   ", "order-1", "123"])(
    "publishes not-found for %j without reading",
    async (orderId) => {
      render(
        <Harness
          account={selected("acct-a")}
          orderId={orderId}
          outerOrder={{ id: "from-list", order_number: "9" }}
        />
      );
      expect(publishedData()).toEqual({ status: "not-found", error: null });
      expect(publishedOrder()).toBeNull();
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountOrder).not.toHaveBeenCalled();
      expect(mockAccountOrders).not.toHaveBeenCalled();
      expect(mockAccountOrderPage).not.toHaveBeenCalled();
    }
  );

  it("publishes loading and skips the read while the account is loading", async () => {
    const { rerender } = render(
      <Harness
        account={selected("acct-a", { isLoading: true })}
        orderId={ORDER}
      />
    );
    expect(publishedData().status).toBe("loading");
    expect(publishedOrder()).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrder).not.toHaveBeenCalled();

    rerender(<Harness account={selected("acct-a")} orderId={ORDER} />);
    await waitFor(() => expect(publishedData().status).toBe("ready"));
    expect(mockAccountOrder).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing account", undefined, "no_account_member"],
    ["anonymous", MOCK_ACCOUNT_ANONYMOUS, "no_account_member"],
    ["member only", MOCK_ACCOUNT_MEMBER_ONLY, "no_selected_account"],
    ["lapsed", MOCK_ACCOUNT_LAPSED, "account_lapsed"],
  ] as const)(
    "publishes %s without reading",
    async (_label, account, code) => {
      render(<Harness account={account} orderId={ORDER} />);
      await waitFor(() => expect(publishedData().error?.code).toBe(code));
      expect(publishedData().status).toBe("error");
      expect(publishedOrder()).toBeNull();
      expect(mockAccountOrder).not.toHaveBeenCalled();
    }
  );

  it("publishes not-found for account_order_not_found and hides the server body", async () => {
    mockAccountOrder.mockRejectedValue(
      refusal("account_order_not_found", "That order could not be found.")
    );
    render(<Harness account={selected("acct-a")} orderId={ORDER} />);
    await waitFor(() => expect(publishedData().status).toBe("not-found"));
    expect(publishedData().error).toBeNull();
    expect(publishedOrder()).toBeNull();
    expect(JSON.stringify(publishedData())).not.toContain("could not be found");
  });

  it.each([
    ["no_session", "No EP session — call /ep/anonymous first to bootstrap."],
    ["no_account_member", "No account member is signed in."],
    ["no_selected_account", "No organisation is selected."],
    [
      "account_lapsed",
      "The account credential ran out and cannot be re-minted. Sign in again.",
    ],
  ] as const)("publishes a server %s error", async (code, message) => {
    mockAccountOrder.mockRejectedValue(refusal(code, message));
    render(<Harness account={selected("acct-a")} orderId={ORDER} />);
    await waitFor(() => expect(publishedData().status).toBe("error"));
    expect(publishedData().error).toEqual({ code, message });
    expect(publishedOrder()).toBeNull();
  });

  it("normalizes an unexpected exception and hides its message", async () => {
    mockAccountOrder.mockRejectedValue(
      new Error("session token sk_live_SECRET at /internal/account-order-detail.ts")
    );
    render(<Harness account={selected("acct-a")} orderId={ORDER} />);
    await waitFor(() => expect(publishedData().status).toBe("error"));
    expect(publishedData().error).toEqual({
      code: "account_orders_read_failed",
      message: UNREACHABLE,
    });
    expect(JSON.stringify(publishedData())).not.toContain("sk_live_SECRET");
    expect(JSON.stringify(publishedOrder())).not.toContain("account-order-detail.ts");
  });

  it("does not refetch for the same account or a trimming-equivalent id", async () => {
    const { rerender } = render(
      <Harness account={selected("acct-a")} orderId={`  ${ORDER.toUpperCase()}  `} />
    );
    await waitFor(() => expect(publishedData().status).toBe("ready"));
    rerender(
      <Harness
        account={selected("acct-a", {
          selectedAccount: { id: "acct-a", name: "Renamed" },
        })}
        orderId={ORDER}
        className="again"
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrder).toHaveBeenCalledTimes(1);
    expect(publishedOrder()?.id).toBe(ORDER);
  });

  it("hides the previous order on the render that selects another account", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderDetail>>> = [];
    mockAccountOrder.mockImplementation(() => {
      const next = deferred<EpAccountOrderDetail>();
      requests.push(next);
      return next.promise;
    });
    const frames: Array<{ status: string; id: string | null }> = [];
    function RecordFrames() {
      const { useSelector } = require("@plasmicapp/host");
      const data = useSelector("accountOrderDetailData") as AccountOrderDetailData;
      const order = useSelector("currentAccountOrder") as EpAccountOrderDetail | null;
      frames.push({ status: data.status, id: order?.id ?? null });
      return null;
    }
    const { rerender } = render(
      <Harness account={selected("acct-a")} orderId={ORDER}>
        <RecordFrames />
      </Harness>
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve(product);
    });
    await waitFor(() => expect(publishedData().status).toBe("ready"));

    const beforeB = frames.length;
    rerender(
      <Harness account={selected("acct-b")} orderId={ORDER}>
        <RecordFrames />
      </Harness>
    );
    expect(requests).toHaveLength(2);
    expect(frames.slice(beforeB).some((frame) => frame.id === ORDER)).toBe(false);

    const beforeReturn = frames.length;
    rerender(
      <Harness account={selected("acct-a")} orderId={ORDER}>
        <RecordFrames />
      </Harness>
    );
    const returned = frames.slice(beforeReturn);
    expect(requests).toHaveLength(3);
    expect(returned[0]).toEqual({ status: "loading", id: null });
    expect(returned.some((frame) => frame.status === "ready")).toBe(false);
    expect(publishedOrder()).toBeNull();
  });

  it("hides the previous order on the render that changes the order id", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderDetail>>> = [];
    mockAccountOrder.mockImplementation(() => {
      const next = deferred<EpAccountOrderDetail>();
      requests.push(next);
      return next.promise;
    });
    const frames: Array<{ status: string; id: string | null }> = [];
    function RecordFrames() {
      const { useSelector } = require("@plasmicapp/host");
      const data = useSelector("accountOrderDetailData") as AccountOrderDetailData;
      const order = useSelector("currentAccountOrder") as EpAccountOrderDetail | null;
      frames.push({ status: data.status, id: order?.id ?? null });
      return null;
    }
    const { rerender } = render(
      <Harness account={selected("acct-a")} orderId={ORDER}>
        <RecordFrames />
      </Harness>
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve(product);
    });
    await waitFor(() => expect(publishedOrder()?.id).toBe(ORDER));

    const beforeY = frames.length;
    rerender(
      <Harness account={selected("acct-a")} orderId={OTHER}>
        <RecordFrames />
      </Harness>
    );
    expect(requests).toHaveLength(2);
    expect(frames.slice(beforeY).some((frame) => frame.id === ORDER)).toBe(false);
    expect(mockAccountOrder).toHaveBeenLastCalledWith({ id: OTHER });

    const beforeReturn = frames.length;
    rerender(
      <Harness account={selected("acct-a")} orderId={ORDER}>
        <RecordFrames />
      </Harness>
    );
    const returned = frames.slice(beforeReturn);
    expect(requests).toHaveLength(3);
    expect(returned[0]).toEqual({ status: "loading", id: null });
    expect(returned.some((frame) => frame.id === ORDER)).toBe(false);
    expect(publishedData().status).toBe("loading");
  });

  it("ignores a late response for the previous order and account", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderDetail>>> = [];
    mockAccountOrder.mockImplementation(() => {
      const next = deferred<EpAccountOrderDetail>();
      requests.push(next);
      return next.promise;
    });
    const { rerender, unmount } = render(
      <Harness account={selected("acct-a")} orderId={ORDER} />
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve(product);
    });
    await waitFor(() => expect(publishedOrder()?.id).toBe(ORDER));

    rerender(<Harness account={selected("acct-a")} orderId={OTHER} />);
    await waitFor(() => expect(requests).toHaveLength(2));
    rerender(<Harness account={selected("acct-b")} orderId={ORDER} />);
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(publishedData().status).toBe("loading");
    expect(publishedOrder()).toBeNull();

    await act(async () => {
      requests[1].resolve(detail(OTHER));
      requests[0].resolve({ ...product, order_number: "stale" });
    });
    expect(publishedData().status).toBe("loading");
    expect(publishedOrder()).toBeNull();

    await act(async () => {
      requests[2].resolve({ ...product, order_number: "fresh" });
    });
    await waitFor(() => expect(publishedOrder()?.order_number).toBe("fresh"));

    unmount();
    await act(async () => {
      requests[2].resolve({ ...product, order_number: "after-unmount" });
    });
  });

  it("retries a generic read failure for the same order", async () => {
    mockAccountOrder.mockRejectedValueOnce(refusal("account_orders_read_failed", READ_FAILED));
    const ref = React.createRef<any>();
    render(<Harness account={selected("acct-a")} orderId={ORDER} detailRef={ref} />);
    await waitFor(() => expect(publishedData().status).toBe("error"));
    expect(publishedData().error).toEqual({
      code: "account_orders_read_failed",
      message: READ_FAILED,
    });
    expect(publishedOrder()).toBeNull();

    mockAccountOrder.mockResolvedValueOnce({ ...product, order_number: "fresh" });
    act(() => {
      ref.current.retry();
    });
    expect(publishedData().status).toBe("loading");
    expect(publishedOrder()).toBeNull();
    await waitFor(() => expect(publishedOrder()?.order_number).toBe("fresh"));
    expect(mockAccountOrder).toHaveBeenCalledTimes(2);
    expect(mockAccountOrder).toHaveBeenLastCalledWith({ id: ORDER });
  });

  it("retries an unexpected exception as a generic read failure", async () => {
    mockAccountOrder.mockRejectedValueOnce(new Error("socket down secret"));
    const ref = React.createRef<any>();
    render(<Harness account={selected("acct-a")} orderId={ORDER} detailRef={ref} />);
    await waitFor(() => expect(publishedData().error?.code).toBe("account_orders_read_failed"));
    mockAccountOrder.mockResolvedValueOnce(product);
    act(() => {
      ref.current.retry();
    });
    await waitFor(() => expect(publishedData().status).toBe("ready"));
    expect(mockAccountOrder).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["loading", undefined],
    ["ready", product],
  ] as const)("does not retry while %s", async (label, resolved) => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderDetail>>> = [];
    if (label === "loading") {
      mockAccountOrder.mockImplementation(() => {
        const next = deferred<EpAccountOrderDetail>();
        requests.push(next);
        return next.promise;
      });
    }
    const ref = React.createRef<any>();
    render(<Harness account={selected("acct-a")} orderId={ORDER} detailRef={ref} />);
    if (label === "ready") {
      await waitFor(() => expect(publishedData().status).toBe("ready"));
    } else {
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(publishedData().status).toBe("loading");
    }
    act(() => {
      ref.current.retry();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrder).toHaveBeenCalledTimes(1);
    if (resolved) expect(publishedOrder()?.id).toBe(ORDER);
  });

  it("does not retry not-found", async () => {
    mockAccountOrder.mockRejectedValue(
      refusal("account_order_not_found", "That order could not be found.")
    );
    const ref = React.createRef<any>();
    render(<Harness account={selected("acct-a")} orderId={ORDER} detailRef={ref} />);
    await waitFor(() => expect(publishedData().status).toBe("not-found"));
    act(() => {
      ref.current.retry();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrder).toHaveBeenCalledTimes(1);
    expect(publishedData().status).toBe("not-found");
    expect(publishedOrder()).toBeNull();
  });

  it.each([
    ["missing account", undefined],
    ["anonymous", MOCK_ACCOUNT_ANONYMOUS],
    ["member only", MOCK_ACCOUNT_MEMBER_ONLY],
    ["lapsed", MOCK_ACCOUNT_LAPSED],
  ] as const)("does not retry a local %s gate", async (_label, account) => {
    const ref = React.createRef<any>();
    render(<Harness account={account} orderId={ORDER} detailRef={ref} />);
    await waitFor(() => expect(publishedData().status).toBe("error"));
    act(() => {
      ref.current.retry();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrder).not.toHaveBeenCalled();
  });

  it.each([
    "no_session",
    "no_account_member",
    "no_selected_account",
    "account_lapsed",
  ] as const)("does not retry a server-returned %s error", async (code) => {
    mockAccountOrder.mockRejectedValue(refusal(code, "static gate"));
    const ref = React.createRef<any>();
    render(<Harness account={selected("acct-a")} orderId={ORDER} detailRef={ref} />);
    await waitFor(() => expect(publishedData().error?.code).toBe(code));
    act(() => {
      ref.current.retry();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrder).toHaveBeenCalledTimes(1);
    expect(publishedData().error?.code).toBe(code);
    expect(publishedOrder()).toBeNull();
  });

  it("does not read in the canvas, and explicit preview states replace auto", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue({ interactive: true });
    const { rerender } = render(
      <Harness account={selected("acct-a")} orderId="" previewState="auto" />
    );
    expect(publishedData().status).toBe("ready");
    expect(publishedOrder()).toEqual(MOCK_ACCOUNT_ORDER_DETAIL);
    expect(mockAccountOrder).not.toHaveBeenCalled();

    rerender(
      <Harness
        account={selected("acct-a")}
        orderId={MOCK_ACCOUNT_ORDER_DETAIL_ITEMLESS.id.toUpperCase()}
        previewState="auto"
      />
    );
    expect(publishedOrder()).toEqual(MOCK_ACCOUNT_ORDER_DETAIL_ITEMLESS);

    rerender(
      <Harness account={selected("acct-a")} orderId={ORDER} previewState="auto" />
    );
    expect(publishedData().status).toBe("not-found");
    expect(publishedOrder()).toBeNull();

    rerender(
      <Harness account={selected("acct-a")} orderId={ORDER} previewState="ready" />
    );
    expect(publishedOrder()).toEqual(MOCK_ACCOUNT_ORDER_DETAIL);

    rerender(
      <Harness account={selected("acct-a")} orderId="" previewState="not-found" />
    );
    expect(publishedData().status).toBe("not-found");
    expect(publishedOrder()).toBeNull();

    rerender(
      <Harness account={selected("acct-a")} orderId="" previewState="loading" />
    );
    expect(publishedData().status).toBe("loading");
    expect(publishedOrder()).toBeNull();

    rerender(
      <Harness account={selected("acct-a")} orderId="" previewState="error" />
    );
    expect(publishedData().error?.code).toBe("account_orders_read_failed");
    expect(publishedOrder()).toBeNull();

    rerender(
      <Harness
        account={selected("acct-a")}
        orderId=""
        previewState="noSelectedAccount"
      />
    );
    expect(publishedData().error?.code).toBe("no_selected_account");

    rerender(
      <Harness account={selected("acct-a")} orderId="" previewState="lapsed" />
    );
    expect(publishedData().error?.code).toBe("account_lapsed");
    expect(mockAccountOrder).not.toHaveBeenCalled();

    const ref = React.createRef<any>();
    rerender(
      <Harness
        account={selected("acct-a")}
        orderId={ORDER}
        previewState="error"
        detailRef={ref}
      />
    );
    act(() => {
      ref.current.retry();
    });
    expect(mockAccountOrder).not.toHaveBeenCalled();
  });

  it("ignores preview state on a published page", async () => {
    render(
      <Harness
        account={selected("acct-a")}
        orderId={ORDER}
        previewState="error"
      />
    );
    await waitFor(() => expect(publishedData().status).toBe("ready"));
    expect(mockAccountOrder).toHaveBeenCalledWith({ id: ORDER });
    expect(publishedOrder()?.id).toBe(ORDER);
  });

  it("does not let a slow read overwrite a newer one under StrictMode", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderDetail>>> = [];
    mockAccountOrder.mockImplementation(() => {
      const next = deferred<EpAccountOrderDetail>();
      requests.push(next);
      return next.promise;
    });
    const { unmount } = render(
      <React.StrictMode>
        <Harness account={selected("acct-a")} orderId={ORDER} />
      </React.StrictMode>
    );
    await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(1));
    const first = requests[0];
    const latest = requests[requests.length - 1];
    await act(async () => {
      latest.resolve({ ...product, order_number: "latest" });
    });
    await waitFor(() => expect(publishedOrder()?.order_number).toBe("latest"));
    await act(async () => {
      first.resolve({ ...product, order_number: "stale" });
    });
    expect(publishedOrder()?.order_number).toBe("latest");
    unmount();
    await act(async () => {
      latest.resolve({ ...product, order_number: "after-unmount" });
    });
    expect(publishedOrder).toThrow();
  });

  describe("registration", () => {
    it("points at the account provider and exposes retry", () => {
      expect(epAccountOrderDetailProviderMeta.name).toBe(
        "plasmic-commerce-ep-account-order-detail-provider"
      );
      expect(epAccountOrderDetailProviderMeta.displayName).toBe(
        "EP Account Order Detail Provider"
      );
      expect(epAccountOrderDetailProviderMeta.importName).toBe(
        "EPAccountOrderDetailProvider"
      );
      expect(epAccountOrderDetailProviderMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-provider"
      );
      expect(epAccountOrderDetailProviderMeta.providesData).toBe(true);
      expect(Object.keys(epAccountOrderDetailProviderMeta.refActions ?? {}).sort()).toEqual([
        "retry",
      ]);
      expect(epAccountOrderDetailProviderMeta.refActions?.retry.argTypes).toEqual([]);
      expect(Object.keys(epAccountOrderDetailProviderMeta.props ?? {}).sort()).toEqual([
        "children",
        "orderId",
        "previewState",
      ]);
      const preview = (epAccountOrderDetailProviderMeta.props as any).previewState;
      expect(preview.options.map((option: { value: string }) => option.value)).toEqual([
        "auto",
        "ready",
        "not-found",
        "loading",
        "error",
        "noSelectedAccount",
        "lapsed",
      ]);
      expect((epAccountOrderDetailProviderMeta.props as any).children.defaultValue).toEqual([
        {
          type: "component",
          name: "plasmic-commerce-ep-account-order-item-list",
        },
      ]);
      expect(JSON.stringify(epAccountOrderDetailProviderMeta)).not.toContain(
        "plasmic-commerce-ep-account-order-field"
      );
      expect(JSON.stringify(epAccountOrderDetailProviderMeta)).not.toContain("nextPage");
      expect(JSON.stringify(epAccountOrderDetailProviderMeta)).not.toContain("previousPage");
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountOrderDetailProvider(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountOrderDetailProvider,
        epAccountOrderDetailProviderMeta
      );
    });
  });
});
