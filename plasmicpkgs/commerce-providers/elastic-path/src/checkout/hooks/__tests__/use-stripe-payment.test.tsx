/**
 * @jest-environment jsdom
 *
 * useStripePayment against a fake Stripe.js.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockStripeJs = require("../../stripe/__tests__/fake-stripe-js").createFakeStripeJs();
jest.mock("../../stripe/load-stripe-js", () => ({
  loadStripeJs: () => mockStripeJs.load(),
}));

import { act, renderHook, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useStripePayment } = require("../use-stripe-payment");

beforeEach(() => mockStripeJs.reset());

describe("useStripePayment", () => {
  it("creates Stripe for the key and Elements for the client secret", async () => {
    const { result } = renderHook(() =>
      useStripePayment({
        stripePublishableKey: "pk_test_123",
        clientSecret: "pi_1_secret_1",
      })
    );

    await waitFor(() => expect(result.current.elements).not.toBeNull());
    expect(result.current.stripe).toBe(mockStripeJs.last());
    expect(mockStripeJs.last().key).toBe("pk_test_123");
    expect(mockStripeJs.last().lastElements!.options.clientSecret).toBe(
      "pi_1_secret_1"
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("confirms the payment through Stripe", async () => {
    const onSuccess = jest.fn();
    const { result } = renderHook(() =>
      useStripePayment({
        stripePublishableKey: "pk_test_123",
        clientSecret: "pi_1_secret_1",
        onSuccess,
      })
    );
    await waitFor(() => expect(result.current.elements).not.toBeNull());
    result.current.elements.create("payment", {});

    let outcome: any;
    await act(async () => {
      outcome = await result.current.confirmPayment({
        return_url: "https://shop.example/done",
      });
    });

    expect(mockStripeJs.last().confirmPayment).toHaveBeenCalledWith({
      elements: result.current.elements,
      confirmParams: { return_url: "https://shop.example/done" },
      redirect: "if_required",
    });
    expect(outcome.paymentIntent.status).toBe("succeeded");
    expect(onSuccess).toHaveBeenCalledWith(outcome.paymentIntent);
  });

  it("reports a missing publishable key", async () => {
    const { result } = renderHook(() =>
      useStripePayment({ stripePublishableKey: "" })
    );

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        "Stripe publishable key is required"
      )
    );
    expect(mockStripeJs.load).not.toHaveBeenCalled();
  });

  it("reports a Stripe.js load failure", async () => {
    const onError = jest.fn();
    mockStripeJs.load.mockRejectedValue(
      new Error("Failed to load Stripe.js from https://js.stripe.com/v3")
    );
    const { result } = renderHook(() =>
      useStripePayment({ stripePublishableKey: "pk_test_123", onError })
    );

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        "Failed to load Stripe.js from https://js.stripe.com/v3"
      )
    );
    expect(onError).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
