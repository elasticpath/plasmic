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

import React from "react";
import { render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPOrderTotalsBreakdown } = require("../EPOrderTotalsBreakdown");

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
        if (name === "checkoutCartData") {
          return { subtotal: 1000, total: 1000, currencyCode: "USD" };
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
});
