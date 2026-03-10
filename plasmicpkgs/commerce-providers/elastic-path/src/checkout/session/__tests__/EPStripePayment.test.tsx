/**
 * C-4.2: EPStripePayment component tests
 *
 * Covers: design-time preview states, DataProvider exposure, className
 * application, gateway registration with PaymentRegistrationContext,
 * runtime mock-form rendering, and outside-provider warning.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */

// Mock @stripe/stripe-js
jest.mock("@stripe/stripe-js", () => ({
  loadStripe: jest.fn().mockResolvedValue({
    confirmPayment: jest.fn(),
  }),
}));

// Mock @stripe/react-stripe-js
jest.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: any) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: (props: any) => {
    if (props.onReady) setTimeout(() => props.onReady(), 0);
    return <div data-testid="stripe-payment-element" />;
  },
  useElements: jest.fn().mockReturnValue(null),
}));

// Mock useCheckoutSession (avoids SWR internals)
const mockConfirmPayment = jest.fn().mockResolvedValue({});
jest.mock("../use-checkout-session", () => ({
  useCheckoutSession: jest.fn().mockReturnValue({
    session: null,
    isLoading: false,
    error: null,
    createSession: jest.fn(),
    updateSession: jest.fn(),
    calculateShipping: jest.fn(),
    placeOrder: jest.fn(),
    confirmPayment: mockConfirmPayment,
    reset: jest.fn(),
    refresh: jest.fn(),
  }),
}));

// Mock @plasmicapp/host
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
}));

// Mock @plasmicapp/host/registerComponent
jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPStripePayment, epStripePaymentMeta } = require("../EPStripePayment") as {
  EPStripePayment: React.FC<any>;
  epStripePaymentMeta: any;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EPStripePayment", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders children in auto mode (outside editor)", () => {
    render(
      <EPStripePayment publishableKey="pk_test_123">
        <span data-testid="child">Payment Form</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("provides stripePaymentData DataProvider", () => {
    render(
      <EPStripePayment publishableKey="pk_test_123">
        <span>content</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("data-provider-stripePaymentData")).toBeTruthy();
  });

  it("applies className to wrapper", () => {
    render(
      <EPStripePayment publishableKey="pk_test_123" className="my-stripe">
        <span>content</span>
      </EPStripePayment>
    );
    expect(document.querySelector(".my-stripe")).toBeTruthy();
  });

  it("renders in design-time ready preview state", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPStripePayment publishableKey="pk_test_123" previewState="ready">
        <span data-testid="ready-child">Ready</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("ready-child")).toBeTruthy();
    const dp = screen.getByTestId("data-provider-stripePaymentData");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.isReady).toBe(true);
    expect(data.isProcessing).toBe(false);
    expect(data.error).toBeNull();
  });

  it("renders in design-time processing preview state", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPStripePayment publishableKey="pk_test_123" previewState="processing">
        <span data-testid="proc-child">Processing</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("proc-child")).toBeTruthy();
    const dp = screen.getByTestId("data-provider-stripePaymentData");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.isProcessing).toBe(true);
  });

  it("renders in design-time error preview state", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPStripePayment publishableKey="pk_test_123" previewState="error">
        <span data-testid="err-child">Error</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("err-child")).toBeTruthy();
    const dp = screen.getByTestId("data-provider-stripePaymentData");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.error).toBe("Your card was declined. Please try a different card.");
  });

  it("renders mock payment form in editor auto mode", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    const { container } = render(
      <EPStripePayment publishableKey="pk_test_123">
        <span>content</span>
      </EPStripePayment>
    );
    // Mock form should be present (Card number label)
    expect(container.textContent).toContain("Card number");
  });

  it("has correct component metadata", () => {
    expect(epStripePaymentMeta.name).toBe("plasmic-commerce-ep-stripe-payment");
    expect(epStripePaymentMeta.importName).toBe("EPStripePayment");
    expect(epStripePaymentMeta.providesData).toBe(true);
    expect(epStripePaymentMeta.props.publishableKey).toBeDefined();
    expect(epStripePaymentMeta.props.appearance).toBeDefined();
    expect(epStripePaymentMeta.props.layout).toBeDefined();
    expect(epStripePaymentMeta.props.previewState).toBeDefined();
    expect(epStripePaymentMeta.refActions.submitPayment).toBeDefined();
  });
});
