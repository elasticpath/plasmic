/** @jest-environment jsdom */

const mockCreateSession = jest.fn().mockResolvedValue({});
const mockUpdateSession = jest.fn().mockResolvedValue({});
const mockCalcShipping = jest.fn().mockResolvedValue({});
const mockPlaceOrder = jest.fn().mockResolvedValue({
  success: true,
  data: { session: { status: "complete", order: { id: "ord-1" } } },
});
const mockConfirmPayment = jest.fn().mockResolvedValue({});
const mockResumePayment = jest.fn().mockResolvedValue({});
const mockAbandonPayment = jest.fn().mockResolvedValue({ success: true });
const mockReset = jest.fn().mockResolvedValue(undefined);
const mockRefresh = jest.fn().mockResolvedValue(undefined);

jest.mock("../use-checkout-session", () => ({
  useCheckoutSession: jest.fn().mockReturnValue({
    session: {
      id: "sess-test",
      status: "open",
      cartId: "cart-1",
      customerInfo: null,
      shippingAddress: null,
      billingAddress: null,
      selectedShippingRateId: null,
      availableShippingRates: [],
      totals: {
        subtotal: 1000,
        tax: 0,
        shipping: 0,
        total: 1000,
        currency: "usd",
      },
      payment: {
        gateway: null,
        status: "idle",
        clientToken: null,
        gatewayMetadata: {},
        actionData: null,
      },
      order: null,
      expiresAt: Date.now() + 60_000,
    },
    isLoading: false,
    error: null,
    createSession: mockCreateSession,
    updateSession: mockUpdateSession,
    calculateShipping: mockCalcShipping,
    placeOrder: mockPlaceOrder,
    confirmPayment: mockConfirmPayment,
    resumePayment: mockResumePayment,
    abandonPayment: mockAbandonPayment,
    reset: mockReset,
    refresh: mockRefresh,
  }),
}));

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  usePlasmicCanvasContext: (...args: any[]) =>
    mockUsePlasmicCanvasContext(...args),
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
  EPManualPayment,
  epManualPaymentMeta,
  registerEPManualPayment,
} = require("../EPManualPayment") as {
  EPManualPayment: React.FC<any>;
  epManualPaymentMeta: any;
  registerEPManualPayment: (loader?: { registerComponent: jest.Mock }) => void;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PaymentRegistrationContext } = require("../payment-registration-context") as {
  PaymentRegistrationContext: React.Context<any>;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCheckoutSessionProvider } = require("../EPCheckoutSessionProvider") as {
  EPCheckoutSessionProvider: React.ForwardRefExoticComponent<any>;
};

function wrapWithRegistration(
  ui: React.ReactElement,
  registerGateway: jest.Mock
) {
  return (
    <PaymentRegistrationContext.Provider
      value={{
        registerGateway,
        getRegisteredGateway: () => null,
      }}
    >
      {ui}
    </PaymentRegistrationContext.Provider>
  );
}

describe("EPManualPayment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("registers gateway manual with empty confirm and no 3DS callback", async () => {
    const registerGateway = jest.fn();
    render(
      wrapWithRegistration(
        <EPManualPayment>
          <span data-testid="child">Pay later</span>
        </EPManualPayment>,
        registerGateway
      )
    );

    await waitFor(() => expect(registerGateway).toHaveBeenCalledTimes(1));
    expect(registerGateway.mock.calls[0][0]).toBe("manual");
    expect(await registerGateway.mock.calls[0][1]()).toEqual({});
    expect(registerGateway.mock.calls[0][2]).toBeUndefined();
  });

  it("does not register a Stripe client token or completeRequiresAction", async () => {
    const registerGateway = jest.fn();
    render(wrapWithRegistration(<EPManualPayment />, registerGateway));

    await waitFor(() => expect(registerGateway).toHaveBeenCalled());
    const confirm = registerGateway.mock.calls[0][1];
    const payload = await confirm();
    expect(payload).not.toHaveProperty("confirmation_token");
    expect(payload).not.toHaveProperty("token");
    expect(payload).not.toHaveProperty("clientToken");
    const options = registerGateway.mock.calls[0][2];
    expect(options?.completeRequiresAction).toBeUndefined();
  });

  it("does not register while in the Studio canvas", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const registerGateway = jest.fn();
    render(wrapWithRegistration(<EPManualPayment />, registerGateway));

    await act(async () => {
      await Promise.resolve();
    });
    expect(registerGateway).not.toHaveBeenCalled();
  });

  it("renders children and manualPaymentData at runtime", () => {
    render(
      <EPManualPayment className="my-manual">
        <span data-testid="child">Invoice copy</span>
      </EPManualPayment>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(document.querySelector(".my-manual")).toBeTruthy();
    expect(document.querySelector("[data-ep-manual-payment]")).toBeTruthy();
    const dp = screen.getByTestId("data-provider-manualPaymentData");
    expect(JSON.parse(dp.getAttribute("data-value") || "{}")).toEqual({
      isReady: true,
      isProcessing: false,
      error: null,
    });
  });

  it("shows a no-card placeholder in Studio", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(<EPManualPayment />);
    expect(screen.getByText(/no card details required/i)).toBeTruthy();
  });

  it("has Studio metadata without Stripe/Clover credential props", () => {
    expect(epManualPaymentMeta.name).toBe("plasmic-commerce-ep-manual-payment");
    expect(epManualPaymentMeta.displayName).toBe("EP Manual Payment");
    expect(epManualPaymentMeta.importName).toBe("EPManualPayment");
    expect(epManualPaymentMeta.providesData).toBe(true);
    expect(epManualPaymentMeta.props.children.type).toBe("slot");
    expect(epManualPaymentMeta.props.publishableKey).toBeUndefined();
    expect(epManualPaymentMeta.props.pakmsKey).toBeUndefined();
    expect(epManualPaymentMeta.refActions).toBeUndefined();
  });

  it("registerEPManualPayment calls loader.registerComponent", () => {
    const loader = { registerComponent: jest.fn() };
    registerEPManualPayment(loader);
    expect(loader.registerComponent).toHaveBeenCalledWith(
      EPManualPayment,
      epManualPaymentMeta
    );
  });
});

describe("EPCheckoutSessionProvider placeOrder with EPManualPayment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
    mockPlaceOrder.mockResolvedValue({
      success: true,
      data: { session: { status: "complete", order: { id: "ord-1" } } },
    });
  });

  it("placeOrder posts only { gateway: 'manual' } and skips Stripe continuation", async () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutSessionProvider ref={ref} autoCreate={false}>
        <EPManualPayment />
      </EPCheckoutSessionProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    let result: any;
    await act(async () => {
      result = await ref.current.placeOrder();
    });

    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    expect(mockPlaceOrder).toHaveBeenCalledWith({ gateway: "manual" });
    expect(mockPlaceOrder.mock.calls[0][0]).not.toHaveProperty(
      "confirmation_token"
    );
    expect(mockResumePayment).not.toHaveBeenCalled();
    expect(mockAbandonPayment).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
    expect(result.data.session.status).toBe("complete");
  });

  it("does not invoke completeRequiresAction when /pay returns requires_action", async () => {
    mockPlaceOrder.mockResolvedValue({
      success: true,
      data: {
        session: {
          status: "open",
          payment: {
            gateway: "manual",
            status: "requires_action",
            clientToken: "should-not-be-used",
          },
        },
      },
    });

    const ref = React.createRef<any>();
    render(
      <EPCheckoutSessionProvider ref={ref} autoCreate={false}>
        <EPManualPayment />
      </EPCheckoutSessionProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await ref.current.placeOrder();
    });

    expect(mockPlaceOrder).toHaveBeenCalledWith({ gateway: "manual" });
    expect(mockResumePayment).not.toHaveBeenCalled();
    expect(mockAbandonPayment).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });
});
