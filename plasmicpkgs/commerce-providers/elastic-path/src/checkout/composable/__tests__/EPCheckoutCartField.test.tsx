/**
 * @jest-environment jsdom
 *
 * EPCheckoutCartField tests
 *
 * The field choice values are the binding contract, so each one is asserted
 * against a cart and a line in Elastic Path's own shape — the paths behind the
 * choices are what moves.
 */

// Mock @plasmicapp/host with controllable fakes
const mockUseSelector = jest.fn().mockReturnValue(undefined);
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);

jest.mock("@plasmicapp/host", () => ({
  useSelector: mockUseSelector,
  usePlasmicCanvasContext: mockUsePlasmicCanvasContext,
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  (fn as any).default = jest.fn();
  return fn;
});

import React from "react";
import { render } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCheckoutCartField } = require("../EPCheckoutCartField");

const money = (amount: number) => ({
  amount,
  currency: "USD",
  float_price: amount / 100,
  formatted: `$${(amount / 100).toFixed(2)}`,
});

const CART = {
  id: "cart-1",
  type: "cart",
  items: [],
  itemCount: 3,
  meta: {
    display_price: {
      without_tax: money(6200),
      tax: money(496),
      shipping: money(595),
      with_tax: money(7291),
    },
  },
};

const ITEM = {
  id: "item-1",
  type: "cart_item",
  name: "Fireside Amber Candle",
  sku: "EW-FA-001",
  quantity: 2,
  image: { href: "https://example.test/candle.png" },
  meta: {
    display_price: {
      without_tax: { unit: money(3800), value: money(7600) },
    },
  },
};

function selectors(data: Record<string, unknown>) {
  mockUseSelector.mockImplementation((name: string) => data[name]);
}

describe("EPCheckoutCartField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  describe("cart fields", () => {
    beforeEach(() => selectors({ cart: CART }));

    it.each([
      ["formattedSubtotal", "$62.00"],
      ["formattedTax", "$4.96"],
      ["formattedShipping", "$5.95"],
      ["formattedTotal", "$72.91"],
      ["itemCount", "3"],
    ])("resolves %s to %s", (field, expected) => {
      const { container } = render(<EPCheckoutCartField field={field} />);
      expect(container.textContent).toBe(expected);
    });

    it("falls back to the without-tax total when the cart carries no with_tax", () => {
      selectors({
        cart: { ...CART, meta: { display_price: { without_tax: money(6200) } } },
      });
      const { container } = render(
        <EPCheckoutCartField field="formattedTotal" />
      );
      expect(container.textContent).toBe("$62.00");
    });

    it("renders nothing outside a cart provider", () => {
      selectors({});
      const { container } = render(
        <EPCheckoutCartField field="formattedTotal" />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("item fields", () => {
    beforeEach(() => selectors({ currentCheckoutItem: ITEM }));

    it.each([
      ["name", "Fireside Amber Candle"],
      ["sku", "EW-FA-001"],
      ["quantity", "2"],
      ["formattedPrice", "$38.00"],
    ])("resolves %s to %s", (field, expected) => {
      const { container } = render(<EPCheckoutCartField field={field} />);
      expect(container.textContent).toBe(expected);
    });

    it("renders imageUrl as an img sourced from the line's image href", () => {
      const { container } = render(<EPCheckoutCartField field="imageUrl" />);
      const img = container.querySelector("img");
      expect(img?.getAttribute("src")).toBe("https://example.test/candle.png");
      expect(img?.getAttribute("alt")).toBe("Fireside Amber Candle");
    });

    it("renders nothing outside an item provider", () => {
      selectors({});
      const { container } = render(<EPCheckoutCartField field="name" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("design-time preview", () => {
    it("uses the mock cart when withData is forced", () => {
      selectors({});
      const { container } = render(
        <EPCheckoutCartField field="formattedTotal" previewState="withData" />
      );
      expect(container.textContent).toBe("$72.91");
    });

    it("uses the mock cart in the canvas when nothing is bound", () => {
      selectors({});
      mockUsePlasmicCanvasContext.mockReturnValue({});
      const { container } = render(
        <EPCheckoutCartField field="formattedSubtotal" />
      );
      expect(container.textContent).toBe("$62.00");
    });

    it("uses the mock line for item fields when withData is forced", () => {
      selectors({});
      const { container } = render(
        <EPCheckoutCartField field="formattedPrice" previewState="withData" />
      );
      expect(container.textContent).toBe("$38.00");
    });
  });
});
