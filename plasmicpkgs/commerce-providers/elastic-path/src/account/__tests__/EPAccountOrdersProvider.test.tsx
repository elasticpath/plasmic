/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockAccountOrders = jest.fn();
const mockAccountAddresses = jest.fn();
const mockIdentity = {
  accountOrders: mockAccountOrders,
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
import type { EpAccountOrder, EpAccountOrderResult } from "../../identity/operations";
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
const { EPAccountOrderList } = require("../EPAccountOrderList");
const { EPAccountAddressProvider, epAccountAddressProviderMeta } = require("../EPAccountAddressProvider");
const { epAccountProviderMeta } = require("../EPAccountProvider");

const orderA: EpAccountOrder = {
  id: "order-a",
  order_number: "1001",
  total: { amount: 1000, currency: "USD", formatted: "$10.00", float_price: 10 },
};
const orderB: EpAccountOrder = {
  id: "order-b",
  order_number: "1002",
  total: { amount: 2000, currency: "USD", formatted: "$20.00", float_price: 20 },
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
  children?: React.ReactNode;
}) {
  const { DataProvider } = require("@plasmicapp/host");
  const { account, previewState, children } = props;
  return (
    <DataProvider name="account" data={account}>
      <EPAccountOrdersProvider previewState={previewState as any}>
        {children}
      </EPAccountOrdersProvider>
    </DataProvider>
  );
}

describe("EPAccountOrdersProvider", () => {
  beforeEach(() => {
    mockAccountOrders.mockReset();
    mockAccountAddresses.mockReset();
    mockAccountOrders.mockResolvedValue({ orders: [], total: 0 });
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
    expect(epAccountOrdersProviderMeta.refActions).toBeUndefined();
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
      expect(epAccountOrdersProviderMeta.refActions).toBeUndefined();
      expect(Object.keys(epAccountOrdersProviderMeta.props ?? {}).sort()).toEqual(
        ["children", "previewState"]
      );
      const preview = (epAccountOrdersProviderMeta.props as any).previewState;
      expect(preview.options.map((option: { value: string }) => option.value)).toEqual([
        "auto",
        "withOrders",
        "empty",
        "loading",
        "error",
        "noSelectedAccount",
        "lapsed",
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
