/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockAccountOrders = jest.fn();
const mockIdentity = { accountOrders: mockAccountOrders };

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
        children
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
import { render, screen, waitFor } from "@testing-library/react";
import type { EpAccountOrder } from "../../identity/operations";
import { MOCK_ACCOUNT_SELECTED } from "../../utils/design-time-data";
import type { AccountContext } from "../types";

const { EPAccountOrdersProvider } = require("../EPAccountOrdersProvider");
const { EPAccountOrderList } = require("../EPAccountOrderList");
const { DataProvider } = require("@plasmicapp/host");

function OrderBinding() {
  const { useSelector } = require("@plasmicapp/host");
  const order = useSelector("currentAccountOrder") as EpAccountOrder | undefined;
  if (!order) return null;
  return (
    <span>
      {order.order_number ?? ""}|{order.meta?.display_price?.with_tax?.formatted ?? ""}
    </span>
  );
}

const full: EpAccountOrder = {
  id: "order-full",
  order_number: "1001",
  status: "complete",
  payment: "paid",
  shipping: "fulfilled",
  meta: {
    timestamps: { created_at: "2024-03-01T12:00:00Z" },
    display_price: {
      with_tax: {
        amount: 4999,
        currency: "USD",
        formatted: "$49.99",
        float_price: 49.99,
      },
    },
  },
};

const sparse: EpAccountOrder = {
  id: "order-sparse",
  order_number: "1002",
};

const account: AccountContext = {
  ...MOCK_ACCOUNT_SELECTED,
  state: "selected",
  isLoading: false,
  selectedAccount: { id: "acct-a", name: "Acme" },
  lapsedAccount: null,
};

function Tree(props: { children?: React.ReactNode }) {
  return (
    <DataProvider name="account" data={account}>
      <EPAccountOrdersProvider>
        <span data-testid="sibling">Stay</span>
        <EPAccountOrderList>{props.children}</EPAccountOrderList>
      </EPAccountOrdersProvider>
    </DataProvider>
  );
}

describe("account order composition", () => {
  beforeEach(() => {
    mockAccountOrders.mockReset();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("renders each order from the row context, including a missing total", async () => {
    mockAccountOrders.mockResolvedValue({ orders: [full, sparse], total: 2 });
    render(
      <Tree>
        <OrderBinding />
      </Tree>
    );

    await waitFor(() => expect(screen.getByText("1001|$49.99")).toBeTruthy());
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("1001|$49.99");
    expect(items[1].textContent).toBe("1002|");
    expect(screen.getByTestId("sibling")).toBeTruthy();
    expect(mockAccountOrders.mock.calls[0]).toEqual([]);
  });

  it("keeps a sibling mounted when the history is empty", async () => {
    mockAccountOrders.mockResolvedValue({ orders: [], total: 0 });
    render(
      <Tree>
        <OrderBinding />
      </Tree>
    );
    await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
    expect(screen.getByTestId("sibling")).toBeTruthy();
  });
});
