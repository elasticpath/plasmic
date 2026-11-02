/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockRepeatedElement = jest.fn(
  (_index: number, children: React.ReactNode) => children
);

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
    repeatedElement: (index: number, children: React.ReactNode) =>
      mockRepeatedElement(index, children),
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen } from "@testing-library/react";
import type { EpAccountOrder } from "../../identity/operations";
import { MOCK_ACCOUNT_ORDERS } from "../../utils/design-time-data";
import type { AccountOrderHistoryContext } from "../types";

const {
  EPAccountOrderList,
  registerEPAccountOrderList,
  epAccountOrderListMeta,
} = require("../EPAccountOrderList");

const orderA: EpAccountOrder = { id: "order-a", order_number: "1001" };
const orderB: EpAccountOrder = { id: "order-b", order_number: "1002" };

function ready(orders: EpAccountOrder[]): AccountOrderHistoryContext {
  return { status: "ready", orders, total: orders.length, error: null };
}

function History(props: {
  history?: AccountOrderHistoryContext;
  children?: React.ReactNode;
}) {
  const { DataProvider } = require("@plasmicapp/host");
  return (
    <DataProvider name="accountOrders" data={props.history}>
      <EPAccountOrderList>{props.children}</EPAccountOrderList>
    </DataProvider>
  );
}

function RowLabel() {
  const { useSelector } = require("@plasmicapp/host");
  const order = useSelector("currentAccountOrder") as EpAccountOrder;
  const index = useSelector("currentAccountOrderIndex") as number;
  return (
    <span>
      {index}:{order.order_number}
    </span>
  );
}

describe("EPAccountOrderList", () => {
  beforeEach(() => {
    mockRepeatedElement.mockClear();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("exposes a different order on each row, including a missing price", () => {
    const priced: EpAccountOrder = {
      id: "order-priced",
      status: "complete",
      payment: "paid",
      created_at: "2024-03-01T12:00:00Z",
      total: {
        amount: 100,
        currency: "USD",
        formatted: "$1.00",
        float_price: 1,
      },
    };
    const bare: EpAccountOrder = { id: "order-bare" };
    function RowBinding() {
      const { useSelector } = require("@plasmicapp/host");
      const order = useSelector("currentAccountOrder") as EpAccountOrder;
      const index = useSelector("currentAccountOrderIndex") as number;
      return (
        <span>
          {index}:{order.id}|{order.status ?? ""}|{order.payment ?? ""}|
          {order.created_at ?? ""}|{order.total?.formatted ?? ""}
        </span>
      );
    }
    render(
      <History history={ready([priced, bare])}>
        <RowBinding />
      </History>
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "0:order-priced|complete|paid|2024-03-01T12:00:00Z|$1.00",
      "1:order-bare||||",
    ]);
  });

  it("repeats children for a ready history and isolates each row", () => {
    render(
      <History history={ready([orderA, orderB])}>
        <RowLabel />
      </History>
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["0:1001", "1:1002"]);
    expect(screen.getByRole("list").getAttribute("aria-label")).toBe(
      "Order history"
    );
    expect(mockRepeatedElement.mock.calls.map((call) => call[0])).toEqual([
      0, 1,
    ]);
  });

  it.each(["loading", "empty", "error"] as const)(
    "renders no rows when status is %s",
    (status) => {
      const history: AccountOrderHistoryContext = {
        status,
        orders: status === "empty" ? [] : [orderA],
        total: 0,
        error:
          status === "error"
            ? { code: "account_orders_read_failed", message: "nope" }
            : null,
      };
      render(
        <History history={history}>
          <span>Row</span>
        </History>
      );
      expect(screen.queryByText("Row")).toBeNull();
      expect(screen.queryByRole("list")).toBeNull();
    }
  );

  it("uses fixture orders on the canvas when no history is published", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(
      <History>
        <RowLabel />
      </History>
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      MOCK_ACCOUNT_ORDERS.map(
        (order, index) => `${index}:${order.order_number}`
      )
    );
  });

  it("does not substitute fixtures over a published empty history on the canvas", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(
      <History history={{ status: "empty", orders: [], total: 0, error: null }}>
        <span>Row</span>
      </History>
    );
    expect(screen.queryByText("Row")).toBeNull();
  });

  describe("registration", () => {
    it("points at the orders provider and has no ref actions", () => {
      expect(epAccountOrderListMeta.displayName).toBe("EP Account Order List");
      expect(epAccountOrderListMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-orders-provider"
      );
      expect(epAccountOrderListMeta.providesData).toBe(true);
      expect(epAccountOrderListMeta.refActions).toBeUndefined();
      const slot = (epAccountOrderListMeta.props as any).children.defaultValue;
      expect(slot).toEqual({ type: "text", value: "Order" });
      expect(JSON.stringify(epAccountOrderListMeta)).not.toContain(
        "plasmic-commerce-ep-account-order-field"
      );
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountOrderList(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountOrderList,
        epAccountOrderListMeta
      );
    });
  });
});
