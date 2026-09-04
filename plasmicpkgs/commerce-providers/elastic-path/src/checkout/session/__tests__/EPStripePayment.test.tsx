/**
 * @jest-environment jsdom
 *
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
  __esModule: true,
  loadStripe: jest.fn().mockResolvedValue({
    confirmPayment: jest.fn(),
    handleNextAction: jest.fn(),
    createConfirmationToken: jest.fn(),
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
    resumePayment: jest.fn(),
    abandonPayment: jest.fn(),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EPStripePayment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(false);
  });

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
    // Mock form sentinel is rendered in design-time
    expect(container.querySelector("[data-ep-stripe-payment]")).toBeTruthy();
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
