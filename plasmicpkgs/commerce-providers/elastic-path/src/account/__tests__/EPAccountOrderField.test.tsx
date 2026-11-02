/** @jest-environment jsdom */

const mockUseSelector = jest.fn().mockReturnValue(undefined);
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);

jest.mock("@plasmicapp/host", () => ({
  useSelector: (key: string) => mockUseSelector(key),
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render } from "@testing-library/react";
import type { EpAccountOrder } from "../../identity/operations";
import { MOCK_ACCOUNT_ORDERS } from "../../utils/design-time-data";
import type { AccountOrderFieldName } from "../types";

const {
  EPAccountOrderField,
  registerEPAccountOrderField,
  epAccountOrderFieldMeta,
} = require("../EPAccountOrderField");

const order: EpAccountOrder = {
  id: "order-1",
  order_number: "1001",
  status: "complete",
  payment: "paid",
  shipping: "fulfilled",
  created_at: "2024-03-01T12:00:00Z",
  total: {
    amount: 4999,
    currency: "USD",
    formatted: "$49.99",
    float_price: 49.99,
  },
};

describe("EPAccountOrderField", () => {
  beforeEach(() => {
    mockUseSelector.mockReset();
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("reads currentAccountOrder", () => {
    mockUseSelector.mockReturnValue(order);
    render(<EPAccountOrderField field="order_number" />);
    expect(mockUseSelector).toHaveBeenCalledWith("currentAccountOrder");
  });

  it.each([
    ["id", "order-1"],
    ["order_number", "1001"],
    ["status", "complete"],
    ["payment", "paid"],
    ["shipping", "fulfilled"],
    ["created_at", "2024-03-01T12:00:00Z"],
    ["total", "$49.99"],
  ] as const)("renders %s", (field: AccountOrderFieldName, expected) => {
    mockUseSelector.mockReturnValue(order);
    const { container } = render(<EPAccountOrderField field={field} />);
    expect(
      container.querySelector("[data-ep-account-order-field]")?.textContent
    ).toBe(expected);
  });

  it("displays the unchanged id when the default field is used and order_number is absent", () => {
    const id = "a804c0a7-8dbc-4696-aa68-892ff6cd26d9";
    mockUseSelector.mockReturnValue({ id, status: "complete" });
    const { container } = render(<EPAccountOrderField />);
    expect(
      container.querySelector("[data-ep-account-order-field]")?.textContent
    ).toBe(id);
  });

  it("renders a blank order number when that property is absent", () => {
    mockUseSelector.mockReturnValue({ id: "order-1", status: "complete" });
    const { container } = render(<EPAccountOrderField field="order_number" />);
    expect(
      container.querySelector("[data-ep-account-order-field]")?.textContent
    ).toBe("");
  });

  it("renders a blank total when the price was omitted", () => {
    mockUseSelector.mockReturnValue({ id: "order-1", order_number: "1001" });
    const { container } = render(<EPAccountOrderField field="total" />);
    expect(container.querySelector("[data-ep-account-order-field]")?.textContent).toBe(
      ""
    );
  });

  it("renders nothing at runtime when there is no current order", () => {
    const { container } = render(<EPAccountOrderField field="order_number" />);
    expect(container.firstChild).toBeNull();
  });

  it("uses the first fixture order on the canvas when none is current", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { container } = render(<EPAccountOrderField field="total" />);
    expect(container.textContent).toBe(MOCK_ACCOUNT_ORDERS[0].total?.formatted);
  });

  describe("registration", () => {
    it("offers id as the default field and keeps order_number optional", () => {
      expect(epAccountOrderFieldMeta.displayName).toBe("EP Account Order Field");
      expect(epAccountOrderFieldMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-orders-provider"
      );
      expect(epAccountOrderFieldMeta.refActions).toBeUndefined();
      const field = (epAccountOrderFieldMeta.props as any).field;
      expect(field.defaultValue).toBe("id");
      expect(field.options.map((option: { value: string }) => option.value)).toEqual([
        "id",
        "order_number",
        "status",
        "payment",
        "shipping",
        "created_at",
        "total",
      ]);
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountOrderField(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountOrderField,
        epAccountOrderFieldMeta
      );
    });
  });
});
