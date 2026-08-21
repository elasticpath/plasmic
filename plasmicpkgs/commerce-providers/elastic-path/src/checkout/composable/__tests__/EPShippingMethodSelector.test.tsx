/**
 * @jest-environment jsdom
 *
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

  describe("without a checkout session", () => {
    // The component used to POST to /api/checkout/calculate-shipping — a route
    // the package retired and answers with 410 Gone — so the shipping step sat
    // empty while a doomed request went out on every valid address.
    it("does not call the retired shipping endpoint", async () => {
      const fetchSpy = jest.fn();
      const originalFetch = global.fetch;
      (global as any).fetch = fetchSpy;

      mockUseSelector.mockImplementation((name: string) =>
        name === "shippingAddressFieldsData"
          ? {
              isValid: true,
              firstName: "Ada",
              lastName: "Lovelace",
              line1: "1 Main St",
              city: "Bristol",
              postcode: "BS1 1AA",
              country: "GB",
            }
          : undefined
      );

      render(
        <EPShippingMethodSelector>
          <span>rate</span>
        </EPShippingMethodSelector>
      );

      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
      (global as any).fetch = originalFetch;
    });

    it("groups the default radio rows in a radiogroup", () => {
      // role="radio" rows without a radiogroup give assistive technology a set
      // of radios with no group semantics or membership.
      mockUseSelector.mockImplementation((name: string) =>
        name === "checkoutSession"
          ? {
              session: {
                availableShippingRates: [
                  { id: "rate_1", name: "Standard", amount: 500, currency: "usd" },
                  { id: "rate_2", name: "Express", amount: 1200, currency: "usd" },
                ],
                selectedShippingRateId: null,
              },
              updateSession: jest.fn().mockResolvedValue(undefined),
            }
          : undefined
      );

      const { container } = render(<EPShippingMethodSelector />);

      const group = container.querySelector("[data-ep-shipping-method-selector]")!;
      expect(group.getAttribute("role")).toBe("radiogroup");
      expect(group.getAttribute("aria-label")).toBeTruthy();
      expect(group.querySelectorAll('[role="radio"]').length).toBeGreaterThan(0);
    });

    it("does not claim radiogroup when the designer supplies the rows", () => {
      mockUseSelector.mockImplementation((name: string) =>
        name === "checkoutSession"
          ? {
              session: {
                availableShippingRates: [
                  { id: "rate_1", name: "Standard", amount: 500, currency: "usd" },
                  { id: "rate_2", name: "Express", amount: 1200, currency: "usd" },
                ],
                selectedShippingRateId: null,
              },
              updateSession: jest.fn().mockResolvedValue(undefined),
            }
          : undefined
      );

      const { container } = render(
        <EPShippingMethodSelector>
          <span>mine</span>
        </EPShippingMethodSelector>
      );

      expect(
        container
          .querySelector("[data-ep-shipping-method-selector]")!
          .getAttribute("role")
      ).toBeNull();
    });

    it("renders the empty state rather than hanging on a load", () => {
      mockUseSelector.mockImplementation((name: string) =>
        name === "shippingAddressFieldsData" ? { isValid: true } : undefined
      );

      const { container } = render(
        <EPShippingMethodSelector>
          <span>rate</span>
        </EPShippingMethodSelector>
      );

      expect(container.textContent).toContain("No shipping methods available");
    });
  });
});
