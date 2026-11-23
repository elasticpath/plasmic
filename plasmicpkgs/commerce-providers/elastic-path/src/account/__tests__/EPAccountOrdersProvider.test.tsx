/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockAccountOrders = jest.fn();
const mockAccountOrderPage = jest.fn();
const mockAccountAddresses = jest.fn();
const mockIdentity = {
  accountOrders: mockAccountOrders,
  accountOrderPage: mockAccountOrderPage,
  accountAddresses: mockAccountAddresses,
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
import type {
  EpAccountOrder,
  EpAccountOrderPageResult,
  EpAccountOrderResult,
} from "../../identity/operations";
import {
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_LAPSED,
  MOCK_ACCOUNT_MEMBER_ONLY,
  MOCK_ACCOUNT_ORDERS,
  MOCK_ACCOUNT_SELECTED,
} from "../../utils/design-time-data";
import type { AccountContext, AccountOrderHistoryContext } from "../types";

const {
  EPAccountOrdersProvider,
  registerEPAccountOrdersProvider,
  epAccountOrdersProviderMeta,
} = require("../EPAccountOrdersProvider");
const { EPAccountOrderList, epAccountOrderListMeta } = require("../EPAccountOrderList");
const { EPAccountAddressProvider, epAccountAddressProviderMeta } = require("../EPAccountAddressProvider");
const { epAccountProviderMeta } = require("../EPAccountProvider");

const orderA: EpAccountOrder = {
  id: "order-a",
  order_number: "1001",
  meta: {
    display_price: {
      with_tax: { amount: 1000, currency: "USD", formatted: "$10.00", float_price: 10 },
    },
  },
};
const orderB: EpAccountOrder = {
  id: "order-b",
  order_number: "1002",
  meta: {
    display_price: {
      with_tax: { amount: 2000, currency: "USD", formatted: "$20.00", float_price: 20 },
    },
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function selected(
  id: string,
  patch: Partial<AccountContext> = {}
): AccountContext {
  return {
    ...MOCK_ACCOUNT_SELECTED,
    state: "selected",
    isLoading: false,
    selectedAccount: { id, name: id },
    lapsedAccount: null,
    ...patch,
  };
}

function published(): AccountOrderHistoryContext {
  const raw = screen
    .getByTestId("data-provider-accountOrders")
    .getAttribute("data-value");
  return JSON.parse(raw || "null");
}

function Harness(props: {
  account?: AccountContext;
  previewState?: string;
  pageSize?: number;
  children?: React.ReactNode;
  ordersRef?: React.Ref<any>;
}) {
  const { DataProvider } = require("@plasmicapp/host");
  const { account, previewState, pageSize, children, ordersRef } = props;
  return (
    <DataProvider name="account" data={account}>
      <EPAccountOrdersProvider
        ref={ordersRef}
        previewState={previewState as any}
        pageSize={pageSize}
      >
        {children}
      </EPAccountOrdersProvider>
    </DataProvider>
  );
}

describe("EPAccountOrdersProvider", () => {
  beforeEach(() => {
    mockAccountOrders.mockReset();
    mockAccountOrderPage.mockReset();
    mockAccountAddresses.mockReset();
    mockAccountOrders.mockResolvedValue({ orders: [], total: 0 });
    mockAccountOrderPage.mockResolvedValue({
      orders: [],
      total: 0,
      page: {
        limit: 10,
        offset: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    mockAccountAddresses.mockResolvedValue({ addresses: [], total: 0 });
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("calls accountOrders with no arguments and publishes the result", async () => {
    const result: EpAccountOrderResult = { orders: [orderA, orderB], total: 2 };
    mockAccountOrders.mockResolvedValue(result);
    render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(mockAccountOrders).toHaveBeenCalledTimes(1);
    expect(mockAccountOrders.mock.calls[0]).toEqual([]);
    expect(published().orders).toEqual(result.orders);
    expect(published().total).toBe(2);
    expect(published().error).toBeNull();
    expect(mockAccountAddresses).not.toHaveBeenCalled();
  });

  it("publishes empty for an empty history and does not treat it as no selection", async () => {
    mockAccountOrders.mockResolvedValue({ orders: [], total: 0 });
    render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(published().status).toBe("empty"));
    expect(published()).toEqual({
      status: "empty",
      orders: [],
      total: 0,
      error: null,
      page: null,
    });
  });

  it("publishes a read failure with the identity code and message", async () => {
    const err = new Error("Elastic Path rejected the account-order read.");
    (err as { code?: string }).code = "account_orders_read_failed";
    mockAccountOrders.mockRejectedValue(err);
    render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().error).toEqual({
      code: "account_orders_read_failed",
      message: "Elastic Path rejected the account-order read.",
    });
    expect(published().orders).toEqual([]);
  });

  it("does not fetch while the account context is loading", async () => {
    const { rerender } = render(
      <Harness account={{ ...selected("acct-a"), isLoading: true }} />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrders).not.toHaveBeenCalled();
    expect(published().status).toBe("loading");

    rerender(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(mockAccountOrders).toHaveBeenCalledTimes(1));
    expect(mockAccountOrders.mock.calls[0]).toEqual([]);
  });

  it.each([
    ["member only", MOCK_ACCOUNT_MEMBER_ONLY, "no_selected_account"],
    ["lapsed", MOCK_ACCOUNT_LAPSED, "account_lapsed"],
    ["anonymous", MOCK_ACCOUNT_ANONYMOUS, "no_account_member"],
  ] as const)(
    "publishes %s without calling accountOrders",
    async (_label, account, code) => {
      render(<Harness account={account} />);
      await waitFor(() => expect(published().status).toBe("error"));
      expect(published().error?.code).toBe(code);
      expect(published().orders).toEqual([]);
      expect(mockAccountOrders).not.toHaveBeenCalled();
    }
  );

  it("publishes no_account_member when no account context is provided", async () => {
    render(<Harness />);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().error?.code).toBe("no_account_member");
    expect(mockAccountOrders).not.toHaveBeenCalled();
  });

  it("clears rows while the same account reloads and does not read again when it returns", async () => {
    mockAccountOrders.mockResolvedValue({ orders: [orderA], total: 1 });
    function OrderNumber() {
      const { useSelector } = require("@plasmicapp/host");
      const order = useSelector("currentAccountOrder") as EpAccountOrder | undefined;
      return <span>{order?.order_number}</span>;
    }
    const rows = (
      <EPAccountOrderList>
        <OrderNumber />
      </EPAccountOrderList>
    );
    const { rerender } = render(
      <Harness account={selected("acct-a")}>{rows}</Harness>
    );
    await waitFor(() => expect(screen.getByText("1001")).toBeTruthy());

    rerender(
      <Harness account={{ ...selected("acct-a"), isLoading: true }}>{rows}</Harness>
    );
    expect(screen.queryByText("1001")).toBeNull();
    expect(published().status).toBe("loading");

    rerender(<Harness account={selected("acct-a")}>{rows}</Harness>);
    expect(screen.getByText("1001")).toBeTruthy();
    expect(mockAccountOrders).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when the same selected account is republished", async () => {
    mockAccountOrders.mockResolvedValue({ orders: [orderA], total: 1 });
    const { rerender } = render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(published().status).toBe("ready"));
    rerender(<Harness account={selected("acct-a", { selectedAccount: { id: "acct-a", name: "Renamed" } })} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrders).toHaveBeenCalledTimes(1);
    expect(published().orders.map((order) => order.id)).toEqual(["order-a"]);
  });

  it("does not publish A's previous history on the render that selects A again", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderResult>>> = [];
    mockAccountOrders.mockImplementation(() => {
      const next = deferred<EpAccountOrderResult>();
      requests.push(next);
      return next.promise;
    });
    const frames: Array<{ status: string; ids: string[] }> = [];
    function RecordFrames() {
      const { useSelector } = require("@plasmicapp/host");
      const history = useSelector("accountOrders") as AccountOrderHistoryContext;
      frames.push({
        status: history.status,
        ids: history.orders.map((order) => order.id),
      });
      return null;
    }
    const { rerender } = render(
      <Harness account={selected("acct-a")}>
        <RecordFrames />
      </Harness>
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve({ orders: [orderA], total: 1 });
    });
    await waitFor(() => expect(published().status).toBe("ready"));

    const beforeB = frames.length;
    rerender(
      <Harness account={selected("acct-b")}>
        <RecordFrames />
      </Harness>
    );
    expect(requests).toHaveLength(2);
    expect(frames.slice(beforeB).some((frame) => frame.ids.includes("order-a"))).toBe(
      false
    );

    const beforeReturn = frames.length;
    rerender(
      <Harness account={selected("acct-a")}>
        <RecordFrames />
      </Harness>
    );
    const returned = frames.slice(beforeReturn);
    expect(requests).toHaveLength(3);
    expect(returned.length).toBeGreaterThan(0);
    expect(returned[0]).toEqual({ status: "loading", ids: [] });
    expect(returned.some((frame) => frame.status === "ready")).toBe(false);
    expect(returned.some((frame) => frame.ids.includes("order-a"))).toBe(false);
    expect(published().status).toBe("loading");
    expect(published().orders).toEqual([]);
  });

  it("stays loading when A is selected again before the new read commits", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderResult>>> = [];
    mockAccountOrders.mockImplementation(() => {
      const next = deferred<EpAccountOrderResult>();
      requests.push(next);
      return next.promise;
    });
    const { rerender, unmount } = render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve({ orders: [orderA], total: 1 });
    });
    await waitFor(() => expect(published().orders.map((order) => order.id)).toEqual(["order-a"]));

    rerender(<Harness account={selected("acct-b")} />);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(published().status).toBe("loading");
    expect(published().orders).toEqual([]);

    rerender(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(published().status).toBe("loading");
    expect(published().orders).toEqual([]);

    await act(async () => {
      requests[1].resolve({ orders: [orderB], total: 1 });
      requests[0].resolve({ orders: [{ ...orderA, order_number: "stale" }], total: 1 });
    });
    expect(published().status).toBe("loading");
    expect(published().orders).toEqual([]);

    await act(async () => {
      requests[2].resolve({ orders: [{ ...orderA, order_number: "fresh" }], total: 1 });
    });
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(published().orders.map((order) => order.order_number)).toEqual(["fresh"]);

    unmount();
    await act(async () => {
      requests[2].resolve({ orders: [{ ...orderA, order_number: "after-unmount" }], total: 1 });
    });
  });

  it("does not publish an unexpected exception message", async () => {
    mockAccountOrders.mockRejectedValue(
      new Error("session token sk_live_SECRET at /internal/account-orders.ts")
    );
    render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().error).toEqual({
      code: "account_orders_read_failed",
      message: "Elastic Path was unreachable.",
    });
    expect(JSON.stringify(published())).not.toContain("sk_live_SECRET");
    expect(JSON.stringify(published())).not.toContain("account-orders.ts");
  });

  it("ignores an in-flight response for A after B has been requested", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderResult>>> = [];
    mockAccountOrders.mockImplementation(() => {
      const next = deferred<EpAccountOrderResult>();
      requests.push(next);
      return next.promise;
    });
    const { rerender } = render(<Harness account={selected("acct-a")} />);
    await waitFor(() => expect(requests).toHaveLength(1));
    rerender(<Harness account={selected("acct-b")} />);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(published().status).toBe("loading");
    expect(published().orders).toEqual([]);

    await act(async () => {
      requests[0].resolve({ orders: [orderA], total: 1 });
    });
    expect(published().status).toBe("loading");
    expect(published().orders).toEqual([]);
    expect(screen.queryByText("1001")).toBeNull();

    await act(async () => {
      requests[1].resolve({ orders: [orderB], total: 1 });
    });
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(published().orders.map((order) => order.id)).toEqual(["order-b"]);

    await act(async () => {
      requests[0].resolve({
        orders: [{ ...orderA, order_number: "Late A" }],
        total: 1,
      });
    });
    expect(published().orders.map((order) => order.id)).toEqual(["order-b"]);
    expect(screen.queryByText("Late A")).toBeNull();
  });

  it.each([
    "auto",
    "withOrders",
    "empty",
    "loading",
    "error",
    "noSelectedAccount",
    "lapsed",
  ] as const)(
    "canvas preview %s does not call accountOrders",
    async (previewState) => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      render(
        <Harness account={selected("acct-a")} previewState={previewState} />
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountOrders).not.toHaveBeenCalled();
    }
  );

  it("shows fixture orders for canvas auto and the forced empty state", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { rerender } = render(
      <Harness account={selected("acct-a")} previewState="auto" />
    );
    expect(published().status).toBe("ready");
    expect(published().orders).toEqual(MOCK_ACCOUNT_ORDERS);
    expect(mockAccountOrders).not.toHaveBeenCalled();

    rerender(<Harness account={selected("acct-a")} previewState="empty" />);
    expect(published().status).toBe("empty");
    expect(published().error).toBeNull();

    rerender(
      <Harness account={selected("acct-a")} previewState="noSelectedAccount" />
    );
    expect(published().error?.code).toBe("no_selected_account");

    rerender(<Harness account={selected("acct-a")} previewState="lapsed" />);
    expect(published().error?.code).toBe("account_lapsed");

    rerender(<Harness account={selected("acct-a")} previewState="error" />);
    expect(published().error?.code).toBe("account_orders_read_failed");
  });

  it("ignores previewState at runtime", async () => {
    mockAccountOrders.mockResolvedValue({ orders: [orderA], total: 1 });
    render(<Harness account={selected("acct-a")} previewState="empty" />);
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(published().orders.map((order) => order.id)).toEqual(["order-a"]);
  });

  it("does not give the address or account provider an order read", async () => {
    const { DataProvider } = require("@plasmicapp/host");
    render(
      <DataProvider name="account" data={selected("acct-a")}>
        <EPAccountAddressProvider />
      </DataProvider>
    );
    await waitFor(() => expect(mockAccountAddresses).toHaveBeenCalledTimes(1));
    expect(mockAccountOrders).not.toHaveBeenCalled();
    expect(JSON.stringify(epAccountAddressProviderMeta)).not.toMatch(
      /accountOrders/
    );
    expect(JSON.stringify(epAccountProviderMeta)).not.toMatch(/accountOrders/);
    expect(epAccountOrderListMeta.refActions).toBeUndefined();
  });

  describe("registration", () => {
    it("exposes only the display props and the account-provider parent", () => {
      expect(epAccountOrdersProviderMeta.name).toBe(
        "plasmic-commerce-ep-account-orders-provider"
      );
      expect(epAccountOrdersProviderMeta.displayName).toBe(
        "EP Account Orders Provider"
      );
      expect(epAccountOrdersProviderMeta.importName).toBe(
        "EPAccountOrdersProvider"
      );
      expect(epAccountOrdersProviderMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-provider"
      );
      expect(epAccountOrdersProviderMeta.providesData).toBe(true);
    expect(Object.keys(epAccountOrdersProviderMeta.refActions ?? {}).sort()).toEqual([
      "nextPage",
      "previousPage",
      "retryPage",
    ]);
    expect(epAccountOrdersProviderMeta.refActions?.nextPage.argTypes).toEqual([]);
    expect(epAccountOrdersProviderMeta.refActions?.previousPage.argTypes).toEqual([]);
    expect(epAccountOrdersProviderMeta.refActions?.retryPage.argTypes).toEqual([]);
    expect(Object.keys(epAccountOrdersProviderMeta.props ?? {}).sort()).toEqual([
      "children",
      "pageSize",
      "previewState",
    ]);
    const preview = (epAccountOrdersProviderMeta.props as any).previewState;
    expect(preview.options.map((option: { value: string }) => option.value)).toEqual([
      "auto",
      "withOrders",
      "empty",
      "loading",
      "error",
      "noSelectedAccount",
      "lapsed",
      "firstPage",
      "middlePage",
      "lastPage",
    ]);
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountOrdersProvider(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountOrdersProvider,
        epAccountOrdersProviderMeta
      );
    });
  });
});

function pageOf(
  orders: EpAccountOrder[],
  offset: number,
  limit = 10,
  hasNextPage = false
): EpAccountOrderPageResult {
  return {
    orders,
    total: orders.length,
    page: {
      limit,
      offset,
      hasNextPage,
      hasPreviousPage: offset > 0,
    },
  };
}

describe("EPAccountOrdersProvider pagination", () => {
  beforeEach(() => {
    mockAccountOrders.mockReset();
    mockAccountOrderPage.mockReset();
    mockAccountAddresses.mockReset();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("calls accountOrderPage for a valid page size and not the full history", async () => {
    mockAccountOrderPage.mockResolvedValue(pageOf([orderA, orderB], 0, 10, true));
    render(
      <Harness account={selected("acct-a")} pageSize={10}>
        <EPAccountOrderList>
          <span>Row</span>
        </EPAccountOrderList>
      </Harness>
    );
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(mockAccountOrders).not.toHaveBeenCalled();
    expect(mockAccountOrderPage).toHaveBeenCalledTimes(1);
    expect(mockAccountOrderPage).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    expect(published().orders.map((order) => order.id)).toEqual(["order-a", "order-b"]);
    expect(published().total).toBe(2);
    expect(published().page).toEqual({
      limit: 10,
      offset: 0,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it.each([0, 1.5, 101, -1])(
    "publishes invalid_page_size for %s and does not read orders",
    async (pageSize) => {
      render(<Harness account={selected("acct-a")} pageSize={pageSize} />);
      expect(published().status).toBe("error");
      expect(published().error?.code).toBe("invalid_page_size");
      expect(published().page).toBeNull();
      expect(published().orders).toEqual([]);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountOrders).not.toHaveBeenCalled();
      expect(mockAccountOrderPage).not.toHaveBeenCalled();
    }
  );

  it("moves one window at a time and retries the same offset", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderPageResult>>> = [];
    mockAccountOrderPage.mockImplementation(() => {
      const next = deferred<EpAccountOrderPageResult>();
      requests.push(next);
      return next.promise;
    });
    const ref = React.createRef<any>();
    const frames: Array<{ status: string; ids: string[]; offset: number | null }> = [];
    function RecordFrames() {
      const { useSelector } = require("@plasmicapp/host");
      const history = useSelector("accountOrders") as AccountOrderHistoryContext;
      frames.push({
        status: history.status,
        ids: history.orders.map((order) => order.id),
        offset: history.page?.offset ?? null,
      });
      return null;
    }
    render(
      <Harness account={selected("acct-a")} pageSize={10} ordersRef={ref}>
        <RecordFrames />
      </Harness>
    );
    expect(frames.at(-1)).toEqual({ status: "loading", ids: [], offset: 0 });
    expect(frames.some((frame) => frame.status === "ready")).toBe(false);
    await act(async () => {
      requests[0].resolve(pageOf([orderA], 0, 10, true));
    });
    await waitFor(() => expect(published().status).toBe("ready"));

    const beforeNext = frames.length;
    act(() => {
      ref.current.nextPage();
      ref.current.nextPage();
    });
    expect(frames.slice(beforeNext).every((frame) => frame.ids.length === 0)).toBe(true);
    expect(frames.slice(beforeNext).some((frame) => frame.status === "ready")).toBe(false);
    expect(published()).toMatchObject({
      status: "loading",
      orders: [],
      page: { limit: 10, offset: 10, hasNextPage: false, hasPreviousPage: false },
    });
    expect(mockAccountOrderPage).toHaveBeenCalledTimes(2);
    expect(mockAccountOrderPage).toHaveBeenLastCalledWith({ limit: 10, offset: 10 });

    await act(async () => {
      requests[1].resolve(pageOf([orderB], 10, 10, false));
    });
    await waitFor(() => expect(published().orders.map((order) => order.id)).toEqual(["order-b"]));

    const beforeBack = frames.length;
    act(() => {
      ref.current.previousPage();
    });
    expect(frames.slice(beforeBack).some((frame) => frame.ids.includes("order-a"))).toBe(false);
    expect(frames.slice(beforeBack).some((frame) => frame.ids.includes("order-b"))).toBe(false);
    expect(published().status).toBe("loading");
    expect(published().page?.offset).toBe(0);
    await act(async () => {
      requests[2].resolve(pageOf([{ ...orderA, order_number: "fresh" }], 0, 10, true));
    });
    await waitFor(() =>
      expect(published().orders.map((order) => order.order_number)).toEqual(["fresh"])
    );

    const failure = new Error("Elastic Path rejected the account-order read.");
    (failure as { code?: string }).code = "account_orders_read_failed";
    mockAccountOrderPage.mockRejectedValueOnce(failure);
    act(() => {
      ref.current.nextPage();
    });
    await waitFor(() => expect(published().status).toBe("error"));
    expect(published().orders).toEqual([]);
    expect(published().page).toEqual({
      limit: 10,
      offset: 10,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    act(() => {
      ref.current.nextPage();
      ref.current.previousPage();
    });
    expect(mockAccountOrderPage).toHaveBeenCalledTimes(4);
    mockAccountOrderPage.mockResolvedValueOnce(pageOf([orderB], 10, 10, false));
    act(() => {
      ref.current.retryPage();
    });
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(mockAccountOrderPage).toHaveBeenLastCalledWith({ limit: 10, offset: 10 });
    expect(published().orders.map((order) => order.id)).toEqual(["order-b"]);
  });

  it("keeps a later empty window ready and a first empty window empty", async () => {
    mockAccountOrderPage.mockResolvedValue(pageOf([], 0, 10, false));
    const ref = React.createRef<any>();
    const { rerender } = render(
      <Harness account={selected("acct-a")} pageSize={10} ordersRef={ref} />
    );
    await waitFor(() => expect(published().status).toBe("empty"));
    expect(published().page?.hasNextPage).toBe(false);

    mockAccountOrderPage.mockResolvedValue(pageOf([], 0, 10, true));
    rerender(<Harness account={selected("acct-b")} pageSize={10} ordersRef={ref} />);
    await waitFor(() => expect(published().status).toBe("ready"));
    expect(published().orders).toEqual([]);
    expect(published().page?.hasNextPage).toBe(true);
    act(() => {
      ref.current.nextPage();
    });
    expect(mockAccountOrderPage).toHaveBeenLastCalledWith({ limit: 10, offset: 10 });
  });

  it("keeps a later empty window ready and can return to the previous page", async () => {
    mockAccountOrderPage
      .mockResolvedValueOnce(pageOf([orderA], 0, 10, true))
      .mockResolvedValueOnce(pageOf([], 10, 10, false))
      .mockResolvedValueOnce(pageOf([orderA], 0, 10, true));
    const ref = React.createRef<any>();
    render(<Harness account={selected("acct-a")} pageSize={10} ordersRef={ref} />);
    await waitFor(() => expect(published().orders.map((order) => order.id)).toEqual(["order-a"]));

    act(() => {
      ref.current.nextPage();
    });
    await waitFor(() => expect(published().page?.offset).toBe(10));
    expect(published().status).toBe("ready");
    expect(published().orders).toEqual([]);
    expect(published().page).toEqual({
      limit: 10,
      offset: 10,
      hasNextPage: false,
      hasPreviousPage: true,
    });

    act(() => {
      ref.current.previousPage();
    });
    await waitFor(() =>
      expect(published().orders.map((order) => order.id)).toEqual(["order-a"])
    );
    expect(published().page?.offset).toBe(0);
    expect(mockAccountOrderPage).toHaveBeenLastCalledWith({ limit: 10, offset: 0 });
  });

  it.each([0, 101])(
    "does not retry an invalid page size of %s",
    async (pageSize) => {
      const ref = React.createRef<any>();
      render(
        <Harness account={selected("acct-a")} pageSize={pageSize} ordersRef={ref} />
      );
      expect(published().error?.code).toBe("invalid_page_size");
      expect(published().page).toBeNull();
      act(() => {
        ref.current.retryPage();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountOrders).not.toHaveBeenCalled();
      expect(mockAccountOrderPage).not.toHaveBeenCalled();
      expect(published().error?.code).toBe("invalid_page_size");
    }
  );

  it.each([
    ["missing member", undefined, "no_account_member"],
    ["missing selection", MOCK_ACCOUNT_MEMBER_ONLY, "no_selected_account"],
  ] as const)(
    "does not retry a %s error",
    async (_label, account, code) => {
      const ref = React.createRef<any>();
      render(<Harness account={account} pageSize={10} ordersRef={ref} />);
      await waitFor(() => expect(published().error?.code).toBe(code));
      expect(published().page).toBeNull();
      act(() => {
        ref.current.retryPage();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountOrders).not.toHaveBeenCalled();
      expect(mockAccountOrderPage).not.toHaveBeenCalled();
      expect(published().error?.code).toBe(code);
    }
  );

  it.each([
    ["no_session", "No EP session — call /ep/anonymous first to bootstrap."],
    ["no_account_member", "No account member is signed in."],
    ["no_selected_account", "No organisation is selected."],
    [
      "account_lapsed",
      "The account credential ran out and cannot be re-minted. Sign in again.",
    ],
  ] as const)(
    "does not retry a server-returned %s error",
    async (code, message) => {
      const failure = new Error(message);
      (failure as { code?: string }).code = code;
      mockAccountOrderPage.mockRejectedValue(failure);
      const ref = React.createRef<any>();
      render(<Harness account={selected("acct-a")} pageSize={10} ordersRef={ref} />);
      await waitFor(() => expect(published().status).toBe("error"));
      expect(published().error).toEqual({ code, message });
      expect(published().orders).toEqual([]);
      expect(published().page).toBeNull();
      expect(mockAccountOrderPage).toHaveBeenCalledTimes(1);
      expect(mockAccountOrderPage).toHaveBeenCalledWith({ limit: 10, offset: 0 });
      act(() => {
        ref.current.retryPage();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountOrderPage).toHaveBeenCalledTimes(1);
      expect(mockAccountOrders).not.toHaveBeenCalled();
      expect(published().error).toEqual({ code, message });
      expect(published().orders).toEqual([]);
      expect(published().page).toBeNull();
    }
  );

  it("does not retry an unpaged read", async () => {
    mockAccountOrders.mockRejectedValue(new Error("Elastic Path was unreachable."));
    const ref = React.createRef<any>();
    render(<Harness account={selected("acct-a")} ordersRef={ref} />);
    await waitFor(() => expect(published().status).toBe("error"));
    expect(mockAccountOrders).toHaveBeenCalledTimes(1);
    act(() => {
      ref.current.retryPage();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrders).toHaveBeenCalledTimes(1);
    expect(mockAccountOrderPage).not.toHaveBeenCalled();
  });

  it("resets to the first page when the account or page size changes", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderPageResult>>> = [];
    mockAccountOrderPage.mockImplementation(() => {
      const next = deferred<EpAccountOrderPageResult>();
      requests.push(next);
      return next.promise;
    });
    const frames: string[][] = [];
    function RecordFrames() {
      const { useSelector } = require("@plasmicapp/host");
      const history = useSelector("accountOrders") as AccountOrderHistoryContext;
      frames.push(history.orders.map((order) => order.id));
      return null;
    }
    const { rerender } = render(
      <Harness account={selected("acct-a")} pageSize={10}>
        <RecordFrames />
      </Harness>
    );
    await act(async () => {
      requests[0].resolve(pageOf([orderA], 0, 10, true));
    });
    await waitFor(() => expect(published().status).toBe("ready"));
    const ref = React.createRef<any>();
    rerender(
      <Harness account={selected("acct-a")} pageSize={10} ordersRef={ref}>
        <RecordFrames />
      </Harness>
    );
    act(() => {
      ref.current.nextPage();
    });
    await act(async () => {
      requests[1].resolve(pageOf([orderB], 10, 10, false));
    });
    await waitFor(() => expect(published().orders.map((order) => order.id)).toEqual(["order-b"]));

    const beforeB = frames.length;
    rerender(
      <Harness account={selected("acct-b")} pageSize={10} ordersRef={ref}>
        <RecordFrames />
      </Harness>
    );
    expect(frames.slice(beforeB).some((ids) => ids.includes("order-b"))).toBe(false);
    expect(frames.slice(beforeB).some((ids) => ids.includes("order-a"))).toBe(false);
    expect(mockAccountOrderPage).toHaveBeenLastCalledWith({ limit: 10, offset: 0 });
    await act(async () => {
      requests[2].resolve(pageOf([{ id: "order-b2" }], 0, 10, false));
    });
    await waitFor(() => expect(published().orders.map((order) => order.id)).toEqual(["order-b2"]));

    const beforeSize = frames.length;
    rerender(
      <Harness account={selected("acct-b")} pageSize={5} ordersRef={ref}>
        <RecordFrames />
      </Harness>
    );
    expect(frames.slice(beforeSize).some((ids) => ids.length > 0)).toBe(false);
    expect(mockAccountOrderPage).toHaveBeenLastCalledWith({ limit: 5, offset: 0 });
  });

  it("discards a stale page when the page size changes before it returns", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderPageResult>>> = [];
    mockAccountOrderPage.mockImplementation(() => {
      const next = deferred<EpAccountOrderPageResult>();
      requests.push(next);
      return next.promise;
    });
    const { rerender } = render(<Harness account={selected("acct-a")} pageSize={10} />);
    await waitFor(() => expect(requests).toHaveLength(1));
    rerender(<Harness account={selected("acct-a")} pageSize={20} />);
    expect(published().orders).toEqual([]);
    await act(async () => {
      requests[0].resolve(pageOf([orderA], 0, 10, true));
    });
    expect(published().orders).toEqual([]);
    await act(async () => {
      requests[1].resolve(pageOf([orderB], 0, 20, false));
    });
    await waitFor(() => expect(published().orders.map((order) => order.id)).toEqual(["order-b"]));
    expect(published().page?.limit).toBe(20);
  });

  it("does not refetch when the same selected account is republished", async () => {
    mockAccountOrderPage.mockResolvedValue(pageOf([orderA], 0, 10, false));
    const { rerender } = render(<Harness account={selected("acct-a")} pageSize={10} />);
    await waitFor(() => expect(published().status).toBe("ready"));
    rerender(
      <Harness
        account={selected("acct-a", {
          selectedAccount: { id: "acct-a", name: "Renamed" },
        })}
        pageSize={10}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrderPage).toHaveBeenCalledTimes(1);
  });

  it("does not let a slow page overwrite a newer one under StrictMode", async () => {
    const requests: Array<ReturnType<typeof deferred<EpAccountOrderPageResult>>> = [];
    mockAccountOrderPage.mockImplementation(() => {
      const next = deferred<EpAccountOrderPageResult>();
      requests.push(next);
      return next.promise;
    });
    const { unmount } = render(
      <React.StrictMode>
        <Harness account={selected("acct-a")} pageSize={10} />
      </React.StrictMode>
    );
    await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(1));
    const first = requests[0];
    const latest = requests[requests.length - 1];
    await act(async () => {
      latest.resolve(pageOf([orderB], 0, 10, false));
    });
    await waitFor(() => expect(published().orders.map((order) => order.id)).toEqual(["order-b"]));
    await act(async () => {
      first.resolve(pageOf([orderA], 0, 10, true));
    });
    expect(published().orders.map((order) => order.id)).toEqual(["order-b"]);
    unmount();
    await act(async () => {
      first.resolve(pageOf([orderA], 0, 10, true));
    });
  });

  it("uses fixture windows on the canvas and does not read orders", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { rerender } = render(
      <Harness account={selected("acct-a")} pageSize={2} previewState="firstPage" />
    );
    expect(published().page).toEqual({
      limit: 2,
      offset: 0,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(published().orders.map((order) => order.id)).toEqual([
      "sample-order-1",
      "sample-order-2",
    ]);
    rerender(<Harness account={selected("acct-a")} pageSize={2} previewState="middlePage" />);
    expect(published().page).toMatchObject({
      offset: 2,
      hasNextPage: true,
      hasPreviousPage: true,
    });
    rerender(<Harness account={selected("acct-a")} pageSize={2} previewState="lastPage" />);
    expect(published().page).toMatchObject({
      offset: 4,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    rerender(<Harness account={selected("acct-a")} previewState="firstPage" />);
    expect(published().page).toBeNull();
    expect(published().orders).toEqual(MOCK_ACCOUNT_ORDERS);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAccountOrders).not.toHaveBeenCalled();
    expect(mockAccountOrderPage).not.toHaveBeenCalled();
  });

  it.each([0, 101, 1.5])(
    "publishes invalid_page_size on the canvas for %s and ignores preview state",
    async (pageSize) => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      const { rerender } = render(
        <Harness
          account={selected("acct-a")}
          pageSize={pageSize}
          previewState="withOrders"
        />
      );
      const invalid = {
        status: "error",
        orders: [],
        total: 0,
        page: null,
        error: {
          code: "invalid_page_size",
          message: "Page size must be an integer from 1 to 100.",
        },
      };
      expect(published()).toEqual(invalid);
      for (const previewState of [
        "auto",
        "firstPage",
        "middlePage",
        "lastPage",
        "empty",
        "loading",
        "error",
        "noSelectedAccount",
        "lapsed",
      ]) {
        rerender(
          <Harness
            account={selected("acct-a")}
            pageSize={pageSize}
            previewState={previewState}
          />
        );
        expect(published()).toEqual(invalid);
      }
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAccountOrders).not.toHaveBeenCalled();
      expect(mockAccountOrderPage).not.toHaveBeenCalled();
    }
  );
});
