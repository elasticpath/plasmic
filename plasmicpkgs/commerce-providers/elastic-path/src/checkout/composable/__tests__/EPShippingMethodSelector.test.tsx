/**
 * EPShippingMethodSelector tests
 *
 * Covers preview states, className, refActions, and session-mode integration
 * (reading availableShippingRates from checkoutSession DataProvider).
 */

// Mock @plasmicapp/host with controllable fakes
const mockUseSelector = jest.fn().mockReturnValue(undefined);
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`dp-${name}`} data-value={JSON.stringify(data)}>{children}</div>
  ),
  repeatedElement: (_i: number, el: any) => el,
  useSelector: mockUseSelector,
  usePlasmicCanvasContext: mockUsePlasmicCanvasContext,
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  (fn as any).default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen, act } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPShippingMethodSelector } = require("../EPShippingMethodSelector");

describe("EPShippingMethodSelector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("renders children with mock rates in withRates preview state", () => {
    render(
      <EPShippingMethodSelector previewState="withRates">
        <span data-testid="rate">Rate</span>
      </EPShippingMethodSelector>
    );
    const rates = screen.getAllByTestId("rate");
    expect(rates.length).toBe(3);
  });

  it("renders loading content in loading preview state", () => {
    render(
      <EPShippingMethodSelector
        previewState="loading"
        loadingContent={<span data-testid="loading">Loading...</span>}
      >
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(screen.getByTestId("loading")).toBeTruthy();
  });

  it("renders empty content in empty preview state", () => {
    render(
      <EPShippingMethodSelector
        previewState="empty"
        emptyContent={<span data-testid="empty">No rates</span>}
      >
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
  });

  it("renders wrapper with data attribute", () => {
    render(
      <EPShippingMethodSelector previewState="withRates">
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(
      document.querySelector("[data-ep-shipping-method-selector]")
    ).toBeTruthy();
  });

  it("applies className to wrapper", () => {
    render(
      <EPShippingMethodSelector previewState="withRates" className="my-selector">
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(document.querySelector(".my-selector")).toBeTruthy();
  });

  it("exposes selectMethod via ref", () => {
    const ref = React.createRef<any>();
    render(
      <EPShippingMethodSelector ref={ref} previewState="withRates">
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current.selectMethod).toBe("function");
  });

  describe("session mode (checkoutSession.availableShippingRates)", () => {
    it("renders rates from checkoutSession DataProvider", () => {
      const mockUpdateSession = jest.fn().mockResolvedValue(undefined);
      mockUseSelector.mockImplementation((name: string) => {
        if (name === "checkoutSession") {
          return {
            session: {
              availableShippingRates: [
                { id: "rate_1", name: "Standard", amount: 500, currency: "usd", carrier: "USPS" },
                { id: "rate_2", name: "Express", amount: 1200, currency: "usd", carrier: "FedEx" },
              ],
              selectedShippingRateId: null,
            },
            updateSession: mockUpdateSession,
          };
        }
        return undefined;
      });

      render(
        <EPShippingMethodSelector>
          <span data-testid="session-rate">Rate</span>
        </EPShippingMethodSelector>
      );

      // Should render 2 rates from session
      const rates = screen.getAllByTestId("session-rate");
      expect(rates.length).toBe(2);
    });

    it("selectMethod calls updateSession in session mode", () => {
      const mockUpdateSession = jest.fn().mockResolvedValue(undefined);
      mockUseSelector.mockImplementation((name: string) => {
        if (name === "checkoutSession") {
          return {
            session: {
              availableShippingRates: [
                { id: "rate_1", name: "Standard", amount: 500, currency: "usd" },
              ],
              selectedShippingRateId: null,
            },
            updateSession: mockUpdateSession,
          };
        }
        return undefined;
      });

      const ref = React.createRef<any>();
      render(
        <EPShippingMethodSelector ref={ref}>
          <span>Rate</span>
        </EPShippingMethodSelector>
      );

      act(() => {
        ref.current.selectMethod("rate_1");
      });

      expect(mockUpdateSession).toHaveBeenCalledWith({
        selectedShippingRateId: "rate_1",
      });
    });
  });
});
