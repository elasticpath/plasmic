/**
 * @jest-environment jsdom
 *
 * CC-3.1: EPPaymentElements component tests
 *
 * Covers: design-time mock rendering, paymentData DataProvider,
 * className application, registration metadata.
 * Runtime tests are limited since Stripe SDK is lazy-loaded.
 */

let mockCheckoutInternalValue: any = {
  clientSecret: null,
  setElements: jest.fn(),
  elements: null,
};

jest.mock("../EPCheckoutProvider", () => ({
  useCheckoutInternal: jest.fn(() => mockCheckoutInternalValue),
}));

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

const mockStripe = { createConfirmationToken: jest.fn() };
jest.mock("@stripe/stripe-js/pure", () => ({
  __esModule: true,
  loadStripe: jest.fn(() => Promise.resolve(mockStripe)),
}));

const mockElements = { submit: jest.fn() };
jest.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children, options }: any) => (
    <div data-testid="stripe-elements" data-options={JSON.stringify(options)}>
      {children}
    </div>
  ),
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useElements: jest.fn(() => mockElements),
}));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPPaymentElements,
  registerEPPaymentElements,
  epPaymentElementsMeta,
} = require("../EPPaymentElements");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePlasmicCanvasContext } = require("@plasmicapp/host");

describe("EPPaymentElements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckoutInternalValue = {
      clientSecret: null,
      setElements: jest.fn(),
      elements: null,
    };
    (usePlasmicCanvasContext as jest.Mock).mockReturnValue(false);
  });

  describe("design-time preview", () => {
    beforeEach(() => {
      (usePlasmicCanvasContext as jest.Mock).mockReturnValue(true);
    });

    it("renders mock payment form in editor with auto previewState", () => {
      render(
        <EPPaymentElements>
          <span data-testid="child">Payment</span>
        </EPPaymentElements>
      );

      expect(screen.getByTestId("child")).toBeTruthy();
      const dp = screen.getByTestId("data-provider-paymentData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.isReady).toBe(true);
      expect(data.isProcessing).toBe(false);
      expect(data.error).toBeNull();
      expect(data.paymentMethodType).toBe("card");
    });

    it("renders mock for previewState=processing", () => {
      render(
        <EPPaymentElements previewState="processing">
          <span>Payment</span>
        </EPPaymentElements>
      );

      const dp = screen.getByTestId("data-provider-paymentData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.isProcessing).toBe(true);
    });

    it("renders mock for previewState=error", () => {
      render(
        <EPPaymentElements previewState="error">
          <span>Payment</span>
        </EPPaymentElements>
      );

      const dp = screen.getByTestId("data-provider-paymentData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.error).toBe(
        "Your card was declined. Please try a different card."
      );
    });

    it("renders data-ep-payment-elements attribute in editor", () => {
      const { container } = render(
        <EPPaymentElements>
          <span>Payment</span>
        </EPPaymentElements>
      );

      const root = container.querySelector("[data-ep-payment-elements]");
      expect(root).toBeTruthy();
    });
  });

  it("applies className to root element in editor", () => {
    (usePlasmicCanvasContext as jest.Mock).mockReturnValue(true);

    const { container } = render(
      <EPPaymentElements className="my-payment">
        <span>Payment</span>
      </EPPaymentElements>
    );

    const root = container.querySelector("[data-ep-payment-elements]");
    expect(root?.className).toContain("my-payment");
  });

  describe("runtime", () => {
    const { loadStripe } = require("@stripe/stripe-js/pure");

    it("renders the card form for the client secret and hands elements to the provider", async () => {
      mockCheckoutInternalValue.clientSecret = "pi_1_secret_2";

      render(
        <EPPaymentElements stripePublishableKey="pk_test_123">
          <span>Payment</span>
        </EPPaymentElements>
      );

      expect(await screen.findByTestId("stripe-payment-element")).toBeTruthy();
      expect(loadStripe).toHaveBeenCalledWith("pk_test_123");
      const options = JSON.parse(
        screen.getByTestId("stripe-elements").getAttribute("data-options")!
      );
      expect(options.clientSecret).toBe("pi_1_secret_2");
      await waitFor(() =>
        expect(mockCheckoutInternalValue.setElements).toHaveBeenCalledWith(
          mockElements
        )
      );
    });

    it("waits for a client secret before rendering Stripe Elements", async () => {
      render(
        <EPPaymentElements stripePublishableKey="pk_test_123">
          <span data-testid="child">Payment</span>
        </EPPaymentElements>
      );

      await waitFor(() => expect(loadStripe).toHaveBeenCalled());
      expect(screen.getByTestId("child")).toBeTruthy();
      expect(screen.queryByTestId("stripe-elements")).toBeNull();
    });
  });

  describe("registration", () => {
    it("has correct meta shape", () => {
      expect(epPaymentElementsMeta.name).toBe(
        "plasmic-commerce-ep-payment-elements"
      );
      expect(epPaymentElementsMeta.displayName).toBe("EP Payment Elements");
      expect(epPaymentElementsMeta.providesData).toBe(true);
    });

    it("registerEPPaymentElements calls loader", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPPaymentElements(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPPaymentElements,
        epPaymentElementsMeta
      );
    });
  });
});
