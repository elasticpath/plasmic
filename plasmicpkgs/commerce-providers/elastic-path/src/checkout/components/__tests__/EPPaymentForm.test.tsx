/**
 * @jest-environment jsdom
 *
 * EPPaymentForm against a fake Stripe.js and the checkout API.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockStripeJs = require("../../stripe/__tests__/fake-stripe-js").createFakeStripeJs();
jest.mock("../../stripe/load-stripe-js", () => ({
  loadStripeJs: () => mockStripeJs.load(),
}));

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPPaymentForm } = require("../EPPaymentForm");

const order = {
  id: "order-1",
  type: "order",
  status: "incomplete",
  payment: "unpaid",
  total: { amount: 4200, currency: "USD" },
  subtotal: { amount: 4200, currency: "USD" },
  tax: { amount: 0, currency: "USD" },
  customer: { name: "Ada Lovelace", email: "ada@example.com" },
  relationships: { items: { data: [] } },
};

const fetchMock = jest.fn();

function respond(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  mockStripeJs.reset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.endsWith("/checkout/setup-payment")) {
      return respond({
        data: { clientSecret: "pi_9_secret_9", transactionId: "txn-1" },
      });
    }
    if (url.endsWith("/checkout/confirm-payment")) {
      return respond({ data: { order: { ...order, payment: "paid" } } });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  (global as any).fetch = fetchMock;
});

describe("EPPaymentForm", () => {
  it("mounts the card form for the order's client secret", async () => {
    render(<EPPaymentForm order={order} stripePublishableKey="pk_test_123" />);

    expect(await screen.findByTestId("stripe-payment-element")).toBeTruthy();
    const stripe = mockStripeJs.last();
    expect(stripe.key).toBe("pk_test_123");
    expect(stripe.lastElements!.options.clientSecret).toBe("pi_9_secret_9");
    expect(stripe.lastElements!.paymentElement!.options).toMatchObject({
      layout: "tabs",
      defaultValues: {
        billingDetails: { name: "Ada Lovelace", email: "ada@example.com" },
      },
    });
  });

  it("confirms the payment with Stripe, then with the checkout API", async () => {
    const onSuccess = jest.fn();
    render(
      <EPPaymentForm
        order={order}
        stripePublishableKey="pk_test_123"
        onSuccess={onSuccess}
      />
    );
    await screen.findByTestId("stripe-payment-element");
    const pay = screen.getByRole("button", { name: /Pay/ });
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(pay);
    });

    const stripe = mockStripeJs.last();
    expect(stripe.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: stripe.lastElements,
        redirect: "if_required",
      })
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const confirmCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith("/checkout/confirm-payment")
    );
    expect(JSON.parse(confirmCall![1].body).stripePaymentIntentId).toBe("pi_fake");
  });

  it("confirms with the transaction that setup created", async () => {
    const onSuccess = jest.fn();
    render(
      <EPPaymentForm
        order={order}
        stripePublishableKey="pk_test_123"
        onSuccess={onSuccess}
      />
    );
    await screen.findByTestId("stripe-payment-element");
    const pay = screen.getByRole("button", { name: /Pay/ });
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(pay);
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const confirmCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith("/checkout/confirm-payment")
    );
    expect(JSON.parse(confirmCall![1].body)).toEqual({
      orderId: "order-1",
      transactionId: "txn-1",
      stripePaymentIntentId: "pi_fake",
    });
  });

  it("updates the theme in place, keeping the card the shopper typed", async () => {
    const view = render(
      <EPPaymentForm order={order} stripePublishableKey="pk_test_123" />
    );
    await screen.findByTestId("stripe-payment-element");
    const stripe = mockStripeJs.last();
    const elements = stripe.lastElements!;

    view.rerender(
      <EPPaymentForm order={order} stripePublishableKey="pk_test_123" theme="night" />
    );

    await waitFor(() =>
      expect(elements.update).toHaveBeenCalledWith({
        appearance: expect.objectContaining({ theme: "night" }),
      })
    );
    expect(stripe.elements).toHaveBeenCalledTimes(1);
    expect(elements.paymentElement!.destroyed).toBe(false);
  });

  it("shows the Stripe error when the payment is declined", async () => {
    render(<EPPaymentForm order={order} stripePublishableKey="pk_test_123" />);
    await screen.findByTestId("stripe-payment-element");
    mockStripeJs.last().confirmPayment.mockResolvedValue({
      error: { message: "Your card was declined." },
    });
    const pay = screen.getByRole("button", { name: /Pay/ });
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(pay);
    });

    expect(await screen.findByText("Your card was declined.")).toBeTruthy();
  });

  it("says payment is unavailable without a publishable key", async () => {
    render(<EPPaymentForm order={order} stripePublishableKey="" />);

    expect(
      await screen.findByText(
        "Payment system not available. Please check your Stripe configuration."
      )
    ).toBeTruthy();
    expect(mockStripeJs.load).not.toHaveBeenCalled();
  });

  it("shows an error when Stripe.js cannot load", async () => {
    mockStripeJs.load.mockRejectedValue(
      new Error("Failed to load Stripe.js from https://js.stripe.com/v3")
    );
    render(<EPPaymentForm order={order} stripePublishableKey="pk_test_123" />);

    expect(
      await screen.findByText("Failed to load Stripe.js from https://js.stripe.com/v3")
    ).toBeTruthy();
  });

  it("destroys the card form on unmount", async () => {
    const view = render(
      <EPPaymentForm order={order} stripePublishableKey="pk_test_123" />
    );
    await screen.findByTestId("stripe-payment-element");
    const element = mockStripeJs.last().lastElements!.paymentElement!;

    view.unmount();

    expect(element.destroyed).toBe(true);
  });
});
