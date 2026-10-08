/**
 * @jest-environment jsdom
 *
 * C-4.2: EPStripePayment component tests
 *
 * Covers: design-time preview states, DataProvider exposure, className
 * application, and the runtime card form inside EPCheckoutSessionProvider
 * against a fake Stripe.js: connected account, confirmation token, 3DS,
 * free cart, missing key and unmount.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockStripeJs = require("../../stripe/__tests__/fake-stripe-js").createFakeStripeJs();
jest.mock("../../stripe/load-stripe-js", () => ({
  loadStripeJs: () => mockStripeJs.load(),
}));

// Mock useCheckoutSession (avoids SWR internals)
const mockPlaceOrder = jest.fn();
const mockResumePayment = jest.fn();
const mockAbandonPayment = jest.fn();
jest.mock("../use-checkout-session", () => ({
  useCheckoutSession: jest.fn(),
}));

// Mock @plasmicapp/host
jest.mock("@plasmicapp/host", () => {
  const { createContext, useContext } = require("react");
  const DataEnv = createContext({});
  return {
    DataProvider: ({ children, name, data }: any) => {
      const env = useContext(DataEnv);
      return (
        <DataEnv.Provider value={{ ...env, [name]: data }}>
          <div
            data-testid={`data-provider-${name}`}
            data-value={JSON.stringify(data)}
          >
            {children}
          </div>
        </DataEnv.Provider>
      );
    },
    useDataEnv: () => useContext(DataEnv),
    usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
  };
});

jest.mock("@plasmicapp/host/registerGlobalContext", () => jest.fn());

// Mock @plasmicapp/host/registerComponent
jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPStripePayment,
  epStripePaymentMeta,
  runStripeRequiresAction,
} = require("../EPStripePayment") as {
  EPStripePayment: React.FC<any>;
  epStripePaymentMeta: any;
  runStripeRequiresAction: (opts: {
    stripe: { handleNextAction: jest.Mock };
    clientSecret: string;
    resumePayment: jest.Mock;
    abandonPayment: jest.Mock;
  }) => Promise<any>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCheckoutSessionProvider } = require("../EPCheckoutSessionProvider");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StripeProvider } = require("../StripeProvider");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useCheckoutSession } = require("../use-checkout-session");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePlasmicCanvasContext } = require("@plasmicapp/host");

function withSession(session: unknown) {
  useCheckoutSession.mockReturnValue({
    session,
    isLoading: false,
    error: null,
    createSession: jest.fn(),
    updateSession: jest.fn(),
    calculateShipping: jest.fn(),
    placeOrder: mockPlaceOrder,
    confirmPayment: jest.fn(),
    resumePayment: mockResumePayment,
    abandonPayment: mockAbandonPayment,
    reset: jest.fn(),
    refresh: jest.fn(),
  });
}

const payableSession = (total = 4200) => ({
  status: "open",
  totals: { total, currency: "USD" },
  payment: { gateway: null, status: "idle", clientToken: null },
});

function dataOf(testId: string) {
  return JSON.parse(screen.getByTestId(testId).getAttribute("data-value") || "{}");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStripeJs.reset();
  usePlasmicCanvasContext.mockReturnValue(false);
  withSession(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EPStripePayment", () => {
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
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPStripePayment publishableKey="pk_test_123" previewState="ready">
        <span data-testid="ready-child">Ready</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("ready-child")).toBeTruthy();
    const data = dataOf("data-provider-stripePaymentData");
    expect(data.isReady).toBe(true);
    expect(data.isProcessing).toBe(false);
    expect(data.error).toBeNull();
  });

  it("renders in design-time processing preview state", () => {
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPStripePayment publishableKey="pk_test_123" previewState="processing">
        <span data-testid="proc-child">Processing</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("proc-child")).toBeTruthy();
    expect(dataOf("data-provider-stripePaymentData").isProcessing).toBe(true);
  });

  it("renders in design-time error preview state", () => {
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPStripePayment publishableKey="pk_test_123" previewState="error">
        <span data-testid="err-child">Error</span>
      </EPStripePayment>
    );
    expect(screen.getByTestId("err-child")).toBeTruthy();
    expect(dataOf("data-provider-stripePaymentData").error).toBe(
      "Your card was declined. Please try a different card."
    );
  });

  it("renders mock payment form in editor auto mode", () => {
    usePlasmicCanvasContext.mockReturnValue(true);

    const { container } = render(
      <EPStripePayment publishableKey="pk_test_123">
        <span>content</span>
      </EPStripePayment>
    );
    // Mock form sentinel is rendered in design-time
    expect(container.querySelector("[data-ep-stripe-payment]")).toBeTruthy();
  });

  it("loads no Stripe.js in any canvas preview state", () => {
    usePlasmicCanvasContext.mockReturnValue(true);
    withSession(payableSession());

    for (const previewState of ["auto", "ready", "processing", "error"]) {
      render(
        <EPStripePayment publishableKey="pk_test_123" previewState={previewState}>
          <span>content</span>
        </EPStripePayment>
      );
    }
    expect(mockStripeJs.load).not.toHaveBeenCalled();
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

describe("EPStripePayment in a checkout session", () => {
  function renderCheckout(
    stripeProps: Record<string, unknown> = { publishableKey: "pk_test_123" },
    providerProps?: Record<string, unknown>
  ) {
    const session = React.createRef<any>();
    const tree = (
      <EPCheckoutSessionProvider ref={session}>
        <EPStripePayment {...stripeProps}>
          <span>content</span>
        </EPStripePayment>
      </EPCheckoutSessionProvider>
    );
    const view = render(
      providerProps ? <StripeProvider {...providerProps}>{tree}</StripeProvider> : tree
    );
    return { session, view };
  }

  beforeEach(() => withSession(payableSession()));

  it("mounts the card form for the cart total", async () => {
    renderCheckout({ publishableKey: "pk_test_123", layout: "accordion" });

    expect(await screen.findByTestId("stripe-payment-element")).toBeTruthy();
    const stripe = mockStripeJs.last();
    expect(stripe.key).toBe("pk_test_123");
    expect(stripe.lastElements!.options).toMatchObject({
      mode: "payment",
      amount: 4200,
      currency: "usd",
    });
    expect(stripe.lastElements!.paymentElement!.options).toEqual({
      layout: "accordion",
    });
    await waitFor(() =>
      expect(dataOf("data-provider-stripePaymentData").isReady).toBe(true)
    );
  });

  it("updates the amount in place, keeping the card the shopper typed", async () => {
    const { view } = renderCheckout();
    await screen.findByTestId("stripe-payment-element");
    const stripe = mockStripeJs.last();
    const elements = stripe.lastElements!;

    withSession(payableSession(5100));
    view.rerender(
      <EPCheckoutSessionProvider>
        <EPStripePayment publishableKey="pk_test_123">
          <span>content</span>
        </EPStripePayment>
      </EPCheckoutSessionProvider>
    );

    await waitFor(() =>
      expect(elements.update).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 5100, currency: "usd" })
      )
    );
    expect(mockStripeJs.instances).toHaveLength(1);
    expect(stripe.elements).toHaveBeenCalledTimes(1);
    expect(elements.paymentElement!.destroyed).toBe(false);
  });

  it("uses the connected account set on the component", async () => {
    renderCheckout({ publishableKey: "pk_test_123", stripeAccount: "acct_9" });
    await screen.findByTestId("stripe-payment-element");
    expect(mockStripeJs.last().options).toEqual({ stripeAccount: "acct_9" });
  });

  it("uses the key and connected account set on EP Stripe Provider", async () => {
    renderCheckout({}, { publishableKey: "pk_test_ctx", stripeAccount: "acct_ctx" });
    await screen.findByTestId("stripe-payment-element");
    expect(mockStripeJs.last().key).toBe("pk_test_ctx");
    expect(mockStripeJs.last().options).toEqual({ stripeAccount: "acct_ctx" });
  });

  it("prefers the component's connected account over the provider's", async () => {
    renderCheckout(
      { stripeAccount: "acct_prop" },
      { publishableKey: "pk_test_ctx", stripeAccount: "acct_ctx" }
    );
    await screen.findByTestId("stripe-payment-element");
    expect(mockStripeJs.last().options).toEqual({ stripeAccount: "acct_prop" });
  });

  it("places the order with a confirmation token", async () => {
    mockPlaceOrder.mockResolvedValue({
      success: true,
      data: { session: { status: "complete" } },
    });
    const { session } = renderCheckout();
    await screen.findByTestId("stripe-payment-element");

    let result: any;
    await act(async () => {
      result = await session.current.placeOrder();
    });

    const stripe = mockStripeJs.last();
    const elements = stripe.lastElements!;
    expect(elements.submit).toHaveBeenCalledTimes(1);
    expect(stripe.createConfirmationToken).toHaveBeenCalledWith({ elements });
    expect(elements.submit.mock.invocationCallOrder[0]).toBeLessThan(
      stripe.createConfirmationToken.mock.invocationCallOrder[0]
    );
    expect(mockPlaceOrder).toHaveBeenCalledWith({
      gateway: "stripe",
      confirmation_token: "ctoken_fake",
    });
    expect(result.success).toBe(true);
  });

  it("mints the token with the Stripe instance that made the card form, even mid key change", async () => {
    mockPlaceOrder.mockResolvedValue({
      success: true,
      data: { session: { status: "complete" } },
    });
    const session = React.createRef<any>();
    const ui = (publishableKey: string) => (
      <EPCheckoutSessionProvider ref={session}>
        <EPStripePayment publishableKey={publishableKey}>
          <span>content</span>
        </EPStripePayment>
      </EPCheckoutSessionProvider>
    );
    const view = render(ui("pk_test_a"));
    await screen.findByTestId("stripe-payment-element");
    const first = mockStripeJs.last();

    let placed: Promise<any> | undefined;
    mockStripeJs.hooks.onConstruct = () =>
      queueMicrotask(() => {
        placed = session.current.placeOrder();
      });
    view.rerender(ui("pk_test_b"));
    await waitFor(() => expect(placed).toBeDefined());

    let result: any;
    await act(async () => {
      result = await placed;
    });
    expect(result.success).toBe(true);
    expect(first.createConfirmationToken).toHaveBeenCalledWith({
      elements: first.lastElements,
    });
  });

  it("does not place the order when the card form is incomplete", async () => {
    const { session } = renderCheckout();
    await screen.findByTestId("stripe-payment-element");
    const stripe = mockStripeJs.last();
    stripe.lastElements!.submit.mockResolvedValue({
      error: { message: "Your card number is incomplete." },
    });

    let result: any;
    await act(async () => {
      result = await session.current.placeOrder();
    });

    expect(stripe.createConfirmationToken).not.toHaveBeenCalled();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(result.error.message).toBe("Your card number is incomplete.");
  });

  it("completes 3DS with the session client secret, then resumes", async () => {
    mockPlaceOrder.mockResolvedValue({
      success: true,
      data: {
        session: {
          status: "open",
          payment: { gateway: "stripe", status: "requires_action", clientToken: "pi_3ds_secret" },
        },
      },
    });
    mockResumePayment.mockResolvedValue({
      success: true,
      data: { session: { status: "complete" } },
    });
    const { session } = renderCheckout();
    await screen.findByTestId("stripe-payment-element");

    let result: any;
    await act(async () => {
      result = await session.current.placeOrder();
    });

    expect(mockStripeJs.last().handleNextAction).toHaveBeenCalledWith({
      clientSecret: "pi_3ds_secret",
    });
    expect(mockResumePayment).toHaveBeenCalled();
    expect(mockAbandonPayment).not.toHaveBeenCalled();
    expect(result.data.session.status).toBe("complete");
  });

  it("abandons the payment when 3DS fails", async () => {
    mockPlaceOrder.mockResolvedValue({
      success: true,
      data: {
        session: {
          status: "open",
          payment: { gateway: "stripe", status: "requires_action", clientToken: "pi_3ds_secret" },
        },
      },
    });
    mockAbandonPayment.mockResolvedValue({
      success: true,
      data: { session: { status: "open", payment: { status: "failed" } } },
    });
    const { session } = renderCheckout();
    await screen.findByTestId("stripe-payment-element");
    mockStripeJs.last().handleNextAction.mockResolvedValue({
      error: { code: "payment_intent_authentication_failure", message: "Declined" },
    });

    let result: any;
    await act(async () => {
      result = await session.current.placeOrder();
    });

    expect(mockAbandonPayment).toHaveBeenCalled();
    expect(mockResumePayment).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("renders the slot without Stripe for a free cart", async () => {
    withSession(payableSession(0));
    const { view } = renderCheckout();

    expect(view.container.querySelector("[data-ep-payment-free]")).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByTestId("stripe-payment-element")).toBeNull();
    expect(mockStripeJs.instances.flatMap((s: any) => s.elements.mock.calls)).toEqual([]);
  });

  it("removes the card form when the cart becomes free", async () => {
    const { view } = renderCheckout();
    await screen.findByTestId("stripe-payment-element");
    const elements = mockStripeJs.last().lastElements!;

    withSession(payableSession(0));
    view.rerender(
      <EPCheckoutSessionProvider>
        <EPStripePayment publishableKey="pk_test_123">
          <span>content</span>
        </EPStripePayment>
      </EPCheckoutSessionProvider>
    );

    await waitFor(() =>
      expect(screen.queryByTestId("stripe-payment-element")).toBeNull()
    );
    expect(elements.paymentElement!.destroyed).toBe(true);
    expect(elements.update).not.toHaveBeenCalled();
  });

  it("shows an error when no publishable key is set", async () => {
    renderCheckout({});

    expect(await screen.findByText("Stripe publishable key is required")).toBeTruthy();
    expect(mockStripeJs.load).not.toHaveBeenCalled();
  });

  it("shows an error when Stripe.js cannot load", async () => {
    mockStripeJs.load.mockRejectedValue(
      new Error("Failed to load Stripe.js from https://js.stripe.com/v3")
    );
    renderCheckout();

    expect(
      await screen.findByText("Failed to load Stripe.js from https://js.stripe.com/v3")
    ).toBeTruthy();
  });

  it("destroys the card form on unmount", async () => {
    const { view } = renderCheckout();
    await screen.findByTestId("stripe-payment-element");
    const element = mockStripeJs.last().lastElements!.paymentElement!;

    view.unmount();

    expect(element.destroyed).toBe(true);
  });
});

describe("runStripeRequiresAction", () => {
  const mockHandleNextAction = jest.fn();
  const mockResumePayment = jest.fn();
  const mockAbandonPayment = jest.fn();
  const stripe = { handleNextAction: mockHandleNextAction };

  const clearedSession = {
    status: "open",
    payment: {
      gateway: "stripe",
      status: "failed",
      clientToken: null,
      actionData: null,
      gatewayMetadata: {},
    },
    order: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHandleNextAction.mockResolvedValue({
      paymentIntent: { status: "succeeded" },
    });
    mockResumePayment.mockResolvedValue({
      success: true,
      data: { session: { status: "complete", order: { id: "ord-1" } } },
    });
    mockAbandonPayment.mockResolvedValue({
      success: true,
      data: { session: clearedSession },
    });
  });

  it("handleNextAction uses the session client secret then resumePayment()", async () => {
    const result = await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockHandleNextAction).toHaveBeenCalledTimes(1);
    expect(mockHandleNextAction).toHaveBeenCalledWith({
      clientSecret: "pi_abc_secret",
    });
    expect(mockResumePayment).toHaveBeenCalledTimes(1);
    expect(mockResumePayment).toHaveBeenCalledWith();
    expect(mockAbandonPayment).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data.session.status).toBe("complete");
  });

  it("does not pass PI id, status, or client secret to resumePayment", async () => {
    await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockResumePayment.mock.calls[0]).toEqual([]);
    expect(mockAbandonPayment).not.toHaveBeenCalled();
  });

  it("does not call resumePayment on authentication failure; clears the cart PI", async () => {
    mockHandleNextAction.mockResolvedValue({
      error: {
        code: "payment_intent_authentication_failure",
        message: "We are unable to authenticate your payment method.",
      },
      paymentIntent: { status: "requires_payment_method" },
    });

    const result = await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockResumePayment).not.toHaveBeenCalled();
    expect(mockAbandonPayment).toHaveBeenCalledTimes(1);
    expect(mockAbandonPayment).toHaveBeenCalledWith();
    expect(mockHandleNextAction).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/authentication failed/i);
    expect(result.error.message).not.toMatch(/3DS still required/i);
    expect(result.data.session.payment.clientToken).toBeNull();
    expect(result.data.session.payment.actionData).toBeNull();
    expect(result.data.session.payment.gatewayMetadata.paymentIntentId).toBeUndefined();
  });

  it("does not call resumePayment when the shopper cancels 3DS; clears the cart PI", async () => {
    mockHandleNextAction.mockResolvedValue({
      error: { message: "canceled" },
      paymentIntent: { status: "canceled" },
    });

    const result = await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockResumePayment).not.toHaveBeenCalled();
    expect(mockAbandonPayment).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/cancelled|canceled/i);
    expect(result.data.session.payment.status).toBe("failed");
  });

  it("does not call resumePayment for requires_source; clears the cart PI", async () => {
    mockHandleNextAction.mockResolvedValue({
      paymentIntent: { status: "requires_source" },
    });

    const result = await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockResumePayment).not.toHaveBeenCalled();
    expect(mockAbandonPayment).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it("surfaces an EP error when clearing the cart PI fails and does not resume", async () => {
    mockHandleNextAction.mockResolvedValue({
      error: { message: "canceled" },
      paymentIntent: { status: "canceled" },
    });
    mockAbandonPayment.mockResolvedValue({
      success: false,
      error: {
        message: "cannot clear payment intent",
        code: "EP_ERROR",
      },
    });

    const result = await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockResumePayment).not.toHaveBeenCalled();
    expect(mockAbandonPayment).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("EP_ERROR");
    expect(result.error.message).toMatch(/cannot clear payment intent/i);
  });

  it("resume 409 PAYMENT_STILL_REQUIRES_ACTION does not abandon or retry handleNextAction", async () => {
    mockResumePayment.mockResolvedValue({
      success: false,
      error: {
        message: "Payment still requires action",
        code: "PAYMENT_STILL_REQUIRES_ACTION",
      },
      data: {
        session: {
          status: "open",
          order: { id: "order-unpaid" },
          payment: {
            status: "requires_action",
            clientToken: "pi_abc_secret",
            gatewayMetadata: { paymentIntentId: "pi_abc" },
          },
        },
      },
    });

    const result = await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockHandleNextAction).toHaveBeenCalledTimes(1);
    expect(mockResumePayment).toHaveBeenCalledTimes(1);
    expect(mockAbandonPayment).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("PAYMENT_STILL_REQUIRES_ACTION");
  });

  it("resume 502 EP_ERROR does not abandon or retry handleNextAction", async () => {
    mockResumePayment.mockResolvedValue({
      success: false,
      error: { code: "EP_ERROR" },
    });

    const result = await runStripeRequiresAction({
      stripe,
      clientSecret: "pi_abc_secret",
      resumePayment: mockResumePayment,
      abandonPayment: mockAbandonPayment,
    });

    expect(mockHandleNextAction).toHaveBeenCalledTimes(1);
    expect(mockAbandonPayment).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("EP_ERROR");
    expect(result.error.message).not.toMatch(/3DS still required/i);
    expect(result.error.message).toMatch(/couldn't confirm/i);
  });
});
