/**
 * @jest-environment jsdom
 *
 * CC-3.1: EPPaymentElements component tests
 *
 * Covers: design-time mock rendering, paymentData DataProvider,
 * className application, registration metadata, and the runtime card form
 * inside the checkout's internal context against a fake Stripe.js.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockStripeJs = require("../../stripe/__tests__/fake-stripe-js").createFakeStripeJs();
jest.mock("../../stripe/load-stripe-js", () => ({
  loadStripeJs: () => mockStripeJs.load(),
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

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPPaymentElements,
  registerEPPaymentElements,
  epPaymentElementsMeta,
} = require("../EPPaymentElements");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CheckoutInternalContext } = require("../EPCheckoutProvider");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePlasmicCanvasContext } = require("@plasmicapp/host");

function paymentData() {
  return JSON.parse(
    screen.getByTestId("data-provider-paymentData").getAttribute("data-value")!
  );
}

describe("EPPaymentElements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStripeJs.reset();
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
      const data = paymentData();
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

      expect(paymentData().isProcessing).toBe(true);
    });

    it("renders mock for previewState=error", () => {
      render(
        <EPPaymentElements previewState="error">
          <span>Payment</span>
        </EPPaymentElements>
      );

      expect(paymentData().error).toBe(
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

    it("loads no Stripe.js in any preview state", () => {
      for (const previewState of ["auto", "ready", "processing", "error"]) {
        render(
          <EPPaymentElements
            stripePublishableKey="pk_test_123"
            previewState={previewState}
          >
            <span>Payment</span>
          </EPPaymentElements>
        );
      }
      expect(mockStripeJs.load).not.toHaveBeenCalled();
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

  describe("in checkout", () => {
    function renderInCheckout(
      clientSecret: string | null,
      props: Record<string, unknown> = { stripePublishableKey: "pk_test_123" }
    ) {
      const setElements = jest.fn();
      const ui = (secret: string | null) => (
        <CheckoutInternalContext.Provider
          value={{ clientSecret: secret, setElements, elements: null }}
        >
          <EPPaymentElements {...props}>
            <span data-testid="child">Payment</span>
          </EPPaymentElements>
        </CheckoutInternalContext.Provider>
      );
      const view = render(ui(clientSecret));
      return {
        setElements,
        view,
        rerenderWith: (secret: string | null) => view.rerender(ui(secret)),
      };
    }

    it("mounts the card form for the client secret and hands elements to the provider", async () => {
      const { setElements } = renderInCheckout("pi_1_secret_2");

      expect(await screen.findByTestId("stripe-payment-element")).toBeTruthy();
      const stripe = mockStripeJs.last();
      expect(stripe.key).toBe("pk_test_123");
      expect(stripe.lastElements!.options.clientSecret).toBe("pi_1_secret_2");
      expect(stripe.lastElements!.paymentElement!.options).toEqual({
        layout: "tabs",
      });
      await waitFor(() =>
        expect(setElements).toHaveBeenCalledWith(stripe.lastElements)
      );
      await waitFor(() => expect(paymentData().isReady).toBe(true));
    });

    it("waits for a client secret before mounting the card form", async () => {
      const { rerenderWith } = renderInCheckout(null);

      await waitFor(() => expect(mockStripeJs.Stripe).toHaveBeenCalled());
      expect(screen.getByTestId("child")).toBeTruthy();
      expect(screen.queryByTestId("stripe-payment-element")).toBeNull();

      rerenderWith("pi_1_secret_2");
      expect(await screen.findByTestId("stripe-payment-element")).toBeTruthy();
    });

    it("updates the appearance in place, keeping the card the shopper typed", async () => {
      const setElements = jest.fn();
      const ui = (appearance: Record<string, unknown>) => (
        <CheckoutInternalContext.Provider
          value={{ clientSecret: "pi_1_secret_2", setElements, elements: null }}
        >
          <EPPaymentElements stripePublishableKey="pk_test_123" appearance={appearance}>
            <span>Payment</span>
          </EPPaymentElements>
        </CheckoutInternalContext.Provider>
      );
      const view = render(ui({ theme: "stripe" }));
      await screen.findByTestId("stripe-payment-element");
      const stripe = mockStripeJs.last();
      const elements = stripe.lastElements!;

      view.rerender(ui({ theme: "night" }));

      await waitFor(() =>
        expect(elements.update).toHaveBeenCalledWith({
          appearance: { theme: "night" },
        })
      );
      expect(stripe.elements).toHaveBeenCalledTimes(1);
      expect(elements.paymentElement!.destroyed).toBe(false);
    });

    it("publishes the payment method the shopper picks and card errors", async () => {
      renderInCheckout("pi_1_secret_2");
      await screen.findByTestId("stripe-payment-element");
      const element = mockStripeJs.last().lastElements!.paymentElement!;

      act(() =>
        element.fire("change", {
          value: { type: "us_bank_account" },
          error: { message: "Your card number is incomplete." },
        })
      );

      expect(paymentData().paymentMethodType).toBe("us_bank_account");
      expect(paymentData().error).toBe("Your card number is incomplete.");
    });

    it("shows an error when no publishable key is set", async () => {
      renderInCheckout("pi_1_secret_2", {});

      expect(
        await screen.findByText("Stripe publishable key is required")
      ).toBeTruthy();
      expect(mockStripeJs.load).not.toHaveBeenCalled();
    });

    it("shows an error when Stripe.js cannot load", async () => {
      mockStripeJs.load.mockRejectedValue(
        new Error("Failed to load Stripe.js from https://js.stripe.com/v3")
      );
      renderInCheckout("pi_1_secret_2");

      expect(
        await screen.findByText(
          "Failed to load Stripe.js from https://js.stripe.com/v3"
        )
      ).toBeTruthy();
    });

    it("destroys the card form on unmount", async () => {
      const { view } = renderInCheckout("pi_1_secret_2");
      await screen.findByTestId("stripe-payment-element");
      const element = mockStripeJs.last().lastElements!.paymentElement!;

      view.unmount();

      expect(element.destroyed).toBe(true);
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
