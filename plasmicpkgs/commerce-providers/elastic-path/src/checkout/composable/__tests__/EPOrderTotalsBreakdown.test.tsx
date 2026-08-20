/**
 * @jest-environment jsdom
 *
 * EPOrderTotalsBreakdown tests
 *
 * Covers preview states, className, fallback, and session-mode integration
 * (reading totals from checkoutSession DataProvider).
 */

// Mock @plasmicapp/host with controllable fakes
const mockUseSelector = jest.fn().mockReturnValue(undefined);
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`dp-${name}`} data-value={JSON.stringify(data)}>{children}</div>
  ),
  useSelector: mockUseSelector,
  usePlasmicCanvasContext: mockUsePlasmicCanvasContext,
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  (fn as any).default = jest.fn();
  return fn;
});

jest.mock("../../../client", () => ({ __esModule: true, default: () => ({}) }));

import React from "react";
import { render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPOrderTotalsBreakdown } = require("../EPOrderTotalsBreakdown");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EpCommerceProvider } = require("../../../shopper-context/EpCommerceContext");

describe("EPOrderTotalsBreakdown", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("renders children inside a data-ep-order-totals-breakdown element", () => {
    render(
      <EPOrderTotalsBreakdown previewState="withData">
        <span data-testid="child">Totals</span>
      </EPOrderTotalsBreakdown>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    const wrapper = document.querySelector("[data-ep-order-totals-breakdown]");
    expect(wrapper).toBeTruthy();
  });

  it("renders with withData preview state", () => {
    render(
      <EPOrderTotalsBreakdown previewState="withData">
        <span data-testid="totals">$72.91</span>
      </EPOrderTotalsBreakdown>
    );
    expect(screen.getByTestId("totals")).toBeTruthy();
  });

  it("applies className to wrapper div", () => {
    render(
      <EPOrderTotalsBreakdown previewState="withData" className="my-totals">
        <span>Totals</span>
      </EPOrderTotalsBreakdown>
    );
    expect(document.querySelector(".my-totals")).toBeTruthy();
  });

  it("renders without context using fallback mock data", () => {
    render(
      <EPOrderTotalsBreakdown previewState="auto">
        <span data-testid="fallback">Fallback</span>
      </EPOrderTotalsBreakdown>
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();
  });

  describe("session mode (checkoutSession.totals)", () => {
    it("reads totals from checkoutSession DataProvider", () => {
      mockUseSelector.mockImplementation((name: string) => {
        if (name === "checkoutSession") {
          return {
            session: {
              totals: {
                subtotal: 5000,
                tax: 500,
                shipping: 800,
                total: 6300,
                currency: "usd",
              },
            },
          };
        }
        return undefined;
      });

      render(
        <EPOrderTotalsBreakdown>
          <span data-testid="session-totals">Totals</span>
        </EPOrderTotalsBreakdown>
      );
      expect(screen.getByTestId("session-totals")).toBeTruthy();

      // Verify the DataProvider was populated with session totals
      const dp = screen.getByTestId("dp-orderTotalsData");
      const data = JSON.parse(dp.getAttribute("data-value") || "{}");
      expect(data.subtotal).toBe(5000);
      expect(data.tax).toBe(500);
      expect(data.shipping).toBe(800);
      expect(data.total).toBe(6300);
      expect(data.currency).toBe("USD");
      // Formatted strings should be present
      expect(data.subtotalFormatted).toContain("50");
      expect(data.totalFormatted).toContain("63");
    });

    it("session totals take priority over cart data", () => {
      mockUseSelector.mockImplementation((name: string) => {
        if (name === "checkoutSession") {
          return {
            session: {
              totals: { subtotal: 5000, tax: 500, shipping: 800, total: 6300, currency: "usd" },
            },
          };
        }
        if (name === "cart") {
          return cartWithTotals(1000);
        }
        return undefined;
      });

      render(
        <EPOrderTotalsBreakdown>
          <span>Totals</span>
        </EPOrderTotalsBreakdown>
      );

      const dp = screen.getByTestId("dp-orderTotalsData");
      const data = JSON.parse(dp.getAttribute("data-value") || "{}");
      // Should use session totals (5000) not cart data (1000)
      expect(data.subtotal).toBe(5000);
    });
  });

  describe("cart mode (the cart published by EPCheckoutCartSummary)", () => {
    it("reads totals off the cart's display_price", () => {
      mockUseSelector.mockImplementation((name: string) =>
        name === "cart" ? cartWithTotals(6200) : undefined
      );

      render(
        <EPOrderTotalsBreakdown>
          <span>Totals</span>
        </EPOrderTotalsBreakdown>
      );

      const dp = screen.getByTestId("dp-orderTotalsData");
      const data = JSON.parse(dp.getAttribute("data-value") || "{}");
      expect(data.subtotal).toBe(6200);
      expect(data.tax).toBe(496);
      expect(data.shipping).toBe(595);
      expect(data.total).toBe(7291);
      expect(data.currency).toBe("USD");
      expect(data.itemCount).toBe(2);
      expect(data.subtotalFormatted).toBe("$62.00");
      expect(data.totalFormatted).toBe("$72.91");
    });
  });

  describe("provider money settings", () => {
    function publishedTotals() {
      const dp = screen.getByTestId("dp-orderTotalsData");
      return JSON.parse(dp.getAttribute("data-value") || "{}");
    }

    const inProvider = (currencyDisplay: string) => (
      <EpCommerceProvider clientId="abc" currencyDisplay={currencyDisplay}>
        <EPOrderTotalsBreakdown>
          <span>Totals</span>
        </EPOrderTotalsBreakdown>
      </EpCommerceProvider>
    );

    // currencyDisplay and locale are bindable props on EpCommerceProvider, so a
    // designer-wired switcher has to reach the totals rather than leaving them
    // stale until unrelated data changes.
    //
    // The selector data is a stable object on purpose: a fresh one per render
    // re-runs the memo whatever its dependencies are, which is what let this
    // bug pass a green suite in the first place.
    it("re-formats the totals when currencyDisplay changes", () => {
      const cart = cartWithTotals(6200);
      mockUseSelector.mockImplementation((name: string) =>
        name === "cart" ? cart : undefined
      );

      const { rerender } = render(inProvider("platform"));
      expect(publishedTotals().subtotalFormatted).toBe("$62.00");

      rerender(inProvider("code"));
      expect(publishedTotals().subtotalFormatted).toBe(
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          currencyDisplay: "code",
        }).format(62)
      );
    });

    it("re-formats session totals when currencyDisplay changes", () => {
      const session = {
        session: { totals: { subtotal: 5000, total: 5000, currency: "usd" } },
      };
      mockUseSelector.mockImplementation((name: string) =>
        name === "checkoutSession" ? session : undefined
      );

      const { rerender } = render(inProvider("platform"));
      const platform = publishedTotals().subtotalFormatted;

      rerender(inProvider("code"));
      expect(publishedTotals().subtotalFormatted).not.toBe(platform);
    });
  });
});

/** A cart in Elastic Path's own shape, with `subtotal` as the without-tax amount. */
function cartWithTotals(subtotal: number) {
  const money = (amount: number) => ({
    amount,
    currency: "USD",
    float_price: amount / 100,
    formatted: `$${(amount / 100).toFixed(2)}`,
  });
  return {
    id: "cart-1",
    type: "cart",
    items: [],
    itemCount: 2,
    meta: {
      display_price: {
        without_tax: money(subtotal),
        tax: money(496),
        shipping: money(595),
        with_tax: money(subtotal + 496 + 595),
      },
    },
  };
}
