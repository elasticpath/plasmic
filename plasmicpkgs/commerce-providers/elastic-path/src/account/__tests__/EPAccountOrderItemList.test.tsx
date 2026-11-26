/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockRepeatedElement = jest.fn(
  (_index: number, children: React.ReactNode) => children
);
const mockAccountOrder = jest.fn();

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

jest.mock("../../identity/useEpIdentity", () => ({
  useEpIdentity: () => ({ accountOrder: mockAccountOrder }),
}));

import React from "react";
import { render, screen } from "@testing-library/react";
import type { EpAccountOrderDetail, EpAccountOrderItem } from "../../identity/operations";
import { MOCK_ACCOUNT_ORDER_DETAIL } from "../../utils/design-time-data";
import type { AccountOrderDetailData } from "../types";

const {
  EPAccountOrderItemList,
  registerEPAccountOrderItemList,
  epAccountOrderItemListMeta,
} = require("../EPAccountOrderItemList");
const { DataProvider, useSelector } = require("@plasmicapp/host");

const shoe: EpAccountOrderItem = {
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
};
const shipping: EpAccountOrderItem = {
  id: "item-ship",
  name: "Shipping",
  sku: "__ep_shipping",
  quantity: 1,
};

function ready(items: EpAccountOrderItem[]): {
  data: AccountOrderDetailData;
  order: EpAccountOrderDetail;
} {
  return {
    data: { status: "ready", error: null },
    order: { id: "order-1", items },
  };
}

function RowLabel() {
  const item = useSelector("currentAccountOrderItem") as EpAccountOrderItem | undefined;
  const index = useSelector("currentAccountOrderItemIndex") as number | undefined;
  if (!item) return null;
  return (
    <span>
      {index}:{item.name}:{item.sku}:{item.quantity}:{item.product_id ?? ""}:
      {item.meta?.display_price?.with_tax?.unit?.formatted ?? ""}:
      {item.meta?.display_price?.with_tax?.value?.formatted ?? ""}
    </span>
  );
}

function List(props: {
  data?: AccountOrderDetailData;
  order?: EpAccountOrderDetail | null;
  children?: React.ReactNode;
}) {
  return (
    <DataProvider name="accountOrderDetailData" data={props.data}>
      <DataProvider name="currentAccountOrder" data={props.order}>
        <EPAccountOrderItemList>{props.children}</EPAccountOrderItemList>
      </DataProvider>
    </DataProvider>
  );
}

describe("EPAccountOrderItemList", () => {
  beforeEach(() => {
    mockRepeatedElement.mockClear();
    mockAccountOrder.mockReset();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("repeats each ready item and publishes its index", () => {
    const state = ready([shoe, shipping]);
    render(
      <List data={state.data} order={state.order}>
        <RowLabel />
      </List>
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "0:Deck shoe:deck-shoe:2:prod-1:$2.50:$5.00",
      "1:Shipping:__ep_shipping:1:::",
    ]);
    expect(mockRepeatedElement).toHaveBeenCalledTimes(2);
    expect(mockAccountOrder).not.toHaveBeenCalled();
  });

  it("renders designer-provided children for each row", () => {
    const state = ready([shoe, shipping]);
    render(
      <List data={state.data} order={state.order}>
        <span>Custom item</span>
      </List>
    );
    expect(screen.getAllByText("Custom item")).toHaveLength(2);
  });

  it("renders no item rows while loading", () => {
    render(
      <List data={{ status: "loading", error: null }} order={null}>
        <span>Custom item</span>
      </List>
    );
    expect(screen.queryAllByRole("listitem")).toEqual([]);
    expect(screen.queryByText("Custom item")).toBeNull();
  });

  it("renders no item rows while error", () => {
    render(
      <List
        data={{
          status: "error",
          error: { code: "account_orders_read_failed", message: "nope" },
        }}
        order={null}
      >
        <span>Custom item</span>
      </List>
    );
    expect(screen.queryAllByRole("listitem")).toEqual([]);
    expect(screen.queryByText("Custom item")).toBeNull();
  });

  it.each(["loading", "not-found", "error"] as const)(
    "renders no rows while %s",
    (status) => {
      render(
        <List
          data={{
            status,
            error: status === "error" ? { code: "account_orders_read_failed", message: "nope" } : null,
          }}
          order={null}
        >
          <span>Custom item</span>
        </List>
      );
      expect(screen.queryByText("Custom item")).toBeNull();
      expect(screen.queryByRole("list")).toBeNull();
    }
  );

  it("renders no rows for an itemless ready order", () => {
    const state = ready([]);
    render(
      <List data={state.data} order={state.order}>
        <span>Custom item</span>
      </List>
    );
    expect(screen.queryByText("Custom item")).toBeNull();
  });

  it("uses fixture items on the canvas when no detail is published", () => {
    mockUsePlasmicCanvasContext.mockReturnValue({ interactive: true });
    render(<EPAccountOrderItemList><RowLabel /></EPAccountOrderItemList>);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      MOCK_ACCOUNT_ORDER_DETAIL.items.map(
        (item, index) =>
          `${index}:${item.name}:${item.sku}:${item.quantity}:${item.product_id ?? ""}:${item.meta?.display_price?.with_tax?.unit?.formatted ?? ""}:${item.meta?.display_price?.with_tax?.value?.formatted ?? ""}`
      )
    );
    expect(mockAccountOrder).not.toHaveBeenCalled();
  });

  it("does not substitute fixtures over a published not-found detail on the canvas", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(
      <List data={{ status: "not-found", error: null }} order={null}>
        <span>Custom item</span>
      </List>
    );
    expect(screen.queryByText("Custom item")).toBeNull();
    expect(mockAccountOrder).not.toHaveBeenCalled();
  });

  describe("registration", () => {
    it("points at the detail provider, repeats text, and has no ref actions", () => {
      expect(epAccountOrderItemListMeta.name).toBe(
        "plasmic-commerce-ep-account-order-item-list"
      );
      expect(epAccountOrderItemListMeta.displayName).toBe("EP Account Order Item List");
      expect(epAccountOrderItemListMeta.importName).toBe("EPAccountOrderItemList");
      expect(epAccountOrderItemListMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-order-detail-provider"
      );
      expect(epAccountOrderItemListMeta.providesData).toBe(true);
      expect(epAccountOrderItemListMeta.refActions).toBeUndefined();
      expect((epAccountOrderItemListMeta.props as any).children.defaultValue).toEqual({
        type: "text",
        value: "Item",
      });
      expect(JSON.stringify(epAccountOrderItemListMeta)).not.toContain(
        "plasmic-commerce-ep-account-order-field"
      );
      expect(JSON.stringify(epAccountOrderItemListMeta)).not.toContain(
        "plasmic-commerce-ep-account-order-item-field"
      );
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountOrderItemList(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountOrderItemList,
        epAccountOrderItemListMeta
      );
    });
  });
});
