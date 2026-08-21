/** @jest-environment jsdom */

const mockUseSelector = jest.fn().mockReturnValue(undefined);
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`dp-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
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
import { act, fireEvent, render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCheckoutShippingRates } = require("../EPCheckoutShippingRates");

const SESSION_RATES = [
  {
    id: "rate-standard",
    name: "Standard Shipping",
    description: "5-7 business days",
    amount: 599,
    currency: "USD",
    deliveryTime: "5-7 business days",
    serviceLevel: "standard",
    carrier: "USPS",
  },
  {
    id: "rate-express",
    name: "Express Shipping",
    amount: 1299,
    currency: "USD",
    serviceLevel: "express",
    carrier: "UPS",
  },
];

describe("EPCheckoutShippingRates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("renders rates from checkoutSession.availableShippingRates", () => {
    mockUseSelector.mockImplementation((name: string) => {
      if (name === "checkoutSession") {
        return {
          session: {
            availableShippingRates: SESSION_RATES,
            selectedShippingRateId: "rate-standard",
          },
          updateSession: jest.fn(),
        };
      }
      return undefined;
    });

    render(
      <EPCheckoutShippingRates>
        <span data-testid="rate">Rate</span>
      </EPCheckoutShippingRates>
    );

    expect(screen.getAllByTestId("rate")).toHaveLength(2);
    const first = screen.getAllByTestId("dp-currentCheckoutShippingRate")[0];
    const data = JSON.parse(first.getAttribute("data-value") ?? "{}");
    expect(data.id).toBe("rate-standard");
    expect(data.amount).toBe(599);
    expect(data.carrier).toBe("USPS");
    expect(data.isSelected).toBe(true);
  });

  it("sends only { selectedShippingRateId } when a rate is selected", () => {
    const mockUpdateSession = jest.fn().mockResolvedValue({ success: true });
    mockUseSelector.mockImplementation((name: string) => {
      if (name === "checkoutSession") {
        return {
          session: {
            availableShippingRates: SESSION_RATES,
            selectedShippingRateId: null,
          },
          updateSession: mockUpdateSession,
        };
      }
      return undefined;
    });

    const ref = React.createRef<{ selectRate: (id: string) => void }>();
    render(
      <EPCheckoutShippingRates ref={ref}>
        <span>Rate</span>
      </EPCheckoutShippingRates>
    );

    act(() => {
      ref.current?.selectRate("rate-express");
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenCalledWith({
      selectedShippingRateId: "rate-express",
    });
    const payload = mockUpdateSession.mock.calls[0][0];
    expect(payload.amount).toBeUndefined();
    expect(Object.keys(payload)).toEqual(["selectedShippingRateId"]);
  });

  it("renders empty content when the session has no rates", () => {
    mockUseSelector.mockImplementation((name: string) => {
      if (name === "checkoutSession") {
        return {
          session: { availableShippingRates: [], selectedShippingRateId: null },
          updateSession: jest.fn(),
        };
      }
      return undefined;
    });

    render(
      <EPCheckoutShippingRates
        emptyContent={<span data-testid="empty">No rates</span>}
      >
        <span>Rate</span>
      </EPCheckoutShippingRates>
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
  });

  it("renders loading content while the session is loading and rates are empty", () => {
    mockUseSelector.mockImplementation((name: string) => {
      if (name === "checkoutSession") {
        return {
          session: { availableShippingRates: [], selectedShippingRateId: null },
          isLoading: true,
          updateSession: jest.fn(),
        };
      }
      return undefined;
    });

    render(
      <EPCheckoutShippingRates
        loadingContent={<span data-testid="loading">Loading</span>}
      >
        <span>Rate</span>
      </EPCheckoutShippingRates>
    );
    expect(screen.getByTestId("loading")).toBeTruthy();
  });

  it("renders mock rates in withRates preview", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(
      <EPCheckoutShippingRates previewState="withRates">
        <span data-testid="rate">Rate</span>
      </EPCheckoutShippingRates>
    );
    expect(screen.getAllByTestId("rate").length).toBeGreaterThan(0);
  });

  describe("with an empty slot", () => {
    // The default was the literal text "Shipping rate" and "$0.00", and the
    // repeater rendered nothing at all without slot content — so the rates were
    // either fake or invisible.
    function withRates(updateSession = jest.fn().mockResolvedValue({})) {
      mockUseSelector.mockImplementation((name: string) =>
        name === "checkoutSession"
          ? {
              session: {
                availableShippingRates: SESSION_RATES,
                selectedShippingRateId: "rate-standard",
              },
              updateSession,
            }
          : undefined
      );
      return updateSession;
    }

    it("renders a row per rate, with its real name and price", () => {
      withRates();

      const { container } = render(<EPCheckoutShippingRates />);

      const rows = container.querySelectorAll("[data-ep-rate-row]");
      expect(rows).toHaveLength(2);
      const names = Array.from(
        container.querySelectorAll("[data-ep-rate-name]")
      ).map((n) => n.textContent);
      expect(names).toContain("Standard Shipping");
      const prices = Array.from(
        container.querySelectorAll("[data-ep-rate-price]")
      ).map((n) => n.textContent);
      expect(prices).toContain("$5.99");
      expect(prices).not.toContain("$0.00");
    });

    it("marks the selected rate", () => {
      withRates();

      const { container } = render(<EPCheckoutShippingRates />);

      const selected = container.querySelectorAll('[data-ep-rate-row][data-selected]');
      expect(selected).toHaveLength(1);
      expect(selected[0].getAttribute("aria-checked")).toBe("true");
    });

    it("lets the shopper pick one, which a read-only default could not", () => {
      const updateSession = withRates();

      const { container } = render(<EPCheckoutShippingRates />);

      const rows = container.querySelectorAll("[data-ep-rate-row]");
      act(() => {
        fireEvent.click(rows[1]);
      });

      expect(updateSession).toHaveBeenCalledWith({
        selectedShippingRateId: SESSION_RATES[1].id,
      });
    });

    it("leaves the slot content alone when there is any", () => {
      withRates();

      const { container } = render(
        <EPCheckoutShippingRates>
          <span data-testid="mine">mine</span>
        </EPCheckoutShippingRates>
      );

      expect(container.querySelectorAll("[data-ep-rate-row]")).toHaveLength(0);
    });
  });
});
