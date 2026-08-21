/**
 * @jest-environment jsdom
 *
 * CC-1.1: EPCheckoutProvider component tests
 *
 * Covers: mount with children, DataProvider exposure of checkoutData,
 * design-time preview states (customerInfo, shipping, payment, confirmation),
 * refActions via useImperativeHandle, className application, and
 * CheckoutInternalContext provision for EPPaymentElements.
 */

// Mock useCheckout hook
const mockSubmitCustomerInfo = jest.fn().mockResolvedValue(undefined);
const mockCalculateShipping = jest.fn().mockResolvedValue([]);
const mockSelectShippingRate = jest.fn();
const mockCreateOrder = jest.fn().mockResolvedValue({
  id: "order-1",
  type: "order",
  status: "incomplete",
  payment: "pending",
  total: { amount: 7291, currency: "USD" },
  subtotal: { amount: 6200, currency: "USD" },
  tax: { amount: 496, currency: "USD" },
  relationships: { items: { data: [] } },
});
const mockSetupPayment = jest.fn().mockResolvedValue({
  clientSecret: "pi_secret_test",
  transactionId: "txn-1",
});
const mockConfirmPayment = jest.fn().mockResolvedValue({});
const mockGoToStep = jest.fn();
const mockNextStep = jest.fn();
const mockPreviousStep = jest.fn();
const mockReset = jest.fn();

// The checkout state the provider derives its summary from.
const defaultCheckoutState = {
  currentStep: "customer_info",
  isLoading: false,
};
let mockCheckoutState: any = defaultCheckoutState;
jest.mock("../../hooks/use-checkout", () => ({
  useCheckout: jest.fn(() => ({
    state: mockCheckoutState,
    submitCustomerInfo: mockSubmitCustomerInfo,
    calculateShipping: mockCalculateShipping,
    selectShippingRate: mockSelectShippingRate,
    createOrder: mockCreateOrder,
    setupPayment: mockSetupPayment,
    confirmPayment: mockConfirmPayment,
    goToStep: mockGoToStep,
    nextStep: mockNextStep,
    previousStep: mockPreviousStep,
    reset: mockReset,
    canProceedToNext: false,
    totalAmount: 7291,
  })),
}));

// The cart the provider reads for pre-order totals.
let mockCart: any = null;
jest.mock("../../../cart-provider/use-ep-cart", () => ({
  useEpCart: () => ({
    cart: mockCart,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

// Mock cart-session (PRD #273: replaces the legacy elasticpath_cart cookie).
jest.mock("../../../cart/cart-session", () => ({
  getCartIdFromSession: jest.fn().mockResolvedValue("cart-123"),
  setCartIdInSession: jest.fn().mockResolvedValue(undefined),
}));

// Mock @plasmicapp/host
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  useSelector: jest.fn().mockReturnValue(undefined),
  usePlasmicCanvasContext: (...args: any[]) =>
    mockUsePlasmicCanvasContext(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen, act } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPCheckoutProvider,
  registerEPCheckoutProvider,
  epCheckoutProviderMeta,
  CheckoutInternalContext,
} = require("../EPCheckoutProvider");

describe("EPCheckoutProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("renders children and exposes checkoutData DataProvider", () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutProvider ref={ref}>
        <span data-testid="child">Hello</span>
      </EPCheckoutProvider>
    );

    expect(screen.getByTestId("child").textContent).toBe("Hello");
    const dp = screen.getByTestId("data-provider-checkoutData");
    expect(dp).toBeTruthy();

    const data = JSON.parse(dp.getAttribute("data-value")!);
    expect(data.step).toBe("customer_info");
    expect(data.stepIndex).toBe(0);
    expect(data.totalSteps).toBe(4);
    expect(data.canProceed).toBe(false);
    expect(data.isProcessing).toBe(false);
  });

  it("applies className to root element", () => {
    const { container } = render(
      <EPCheckoutProvider className="my-checkout">
        <span>child</span>
      </EPCheckoutProvider>
    );

    const root = container.querySelector("[data-ep-checkout-provider]");
    expect(root?.className).toContain("my-checkout");
  });

  it("exposes refActions", () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutProvider ref={ref}>
        <span>child</span>
      </EPCheckoutProvider>
    );

    expect(ref.current).toBeTruthy();
    expect(typeof ref.current.nextStep).toBe("function");
    expect(typeof ref.current.previousStep).toBe("function");
    expect(typeof ref.current.goToStep).toBe("function");
    expect(typeof ref.current.submitCustomerInfo).toBe("function");
    expect(typeof ref.current.submitShippingAddress).toBe("function");
    expect(typeof ref.current.submitBillingAddress).toBe("function");
    expect(typeof ref.current.selectShippingRate).toBe("function");
    expect(typeof ref.current.submitPayment).toBe("function");
    expect(typeof ref.current.reset).toBe("function");
  });

  it("calls useCheckout nextStep when refAction called", () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutProvider ref={ref}>
        <span>child</span>
      </EPCheckoutProvider>
    );

    act(() => {
      ref.current.nextStep();
    });

    expect(mockNextStep).toHaveBeenCalled();
  });

  it("calls useCheckout previousStep when refAction called", () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutProvider ref={ref}>
        <span>child</span>
      </EPCheckoutProvider>
    );

    act(() => {
      ref.current.previousStep();
    });

    expect(mockPreviousStep).toHaveBeenCalled();
  });

  it("calls useCheckout goToStep when refAction called", () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutProvider ref={ref}>
        <span>child</span>
      </EPCheckoutProvider>
    );

    act(() => {
      ref.current.goToStep("shipping");
    });

    expect(mockGoToStep).toHaveBeenCalledWith("shipping");
  });

  it("calls reset when refAction called", () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutProvider ref={ref}>
        <span>child</span>
      </EPCheckoutProvider>
    );

    act(() => {
      ref.current.reset();
    });

    expect(mockReset).toHaveBeenCalled();
  });

  describe("design-time preview", () => {
    beforeEach(() => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
    });

    it("renders customerInfo mock when previewState=customerInfo", () => {
      render(
        <EPCheckoutProvider previewState="customerInfo">
          <span data-testid="child">Preview</span>
        </EPCheckoutProvider>
      );

      const dp = screen.getByTestId("data-provider-checkoutData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.step).toBe("customer_info");
      expect(data.stepIndex).toBe(0);
    });

    it("renders shipping mock when previewState=shipping", () => {
      render(
        <EPCheckoutProvider previewState="shipping">
          <span>Preview</span>
        </EPCheckoutProvider>
      );

      const dp = screen.getByTestId("data-provider-checkoutData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.step).toBe("shipping");
      expect(data.stepIndex).toBe(1);
    });

    it("renders payment mock when previewState=payment", () => {
      render(
        <EPCheckoutProvider previewState="payment">
          <span>Preview</span>
        </EPCheckoutProvider>
      );

      const dp = screen.getByTestId("data-provider-checkoutData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.step).toBe("payment");
      expect(data.stepIndex).toBe(2);
    });

    it("renders confirmation mock when previewState=confirmation", () => {
      render(
        <EPCheckoutProvider previewState="confirmation">
          <span>Preview</span>
        </EPCheckoutProvider>
      );

      const dp = screen.getByTestId("data-provider-checkoutData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.step).toBe("confirmation");
      expect(data.stepIndex).toBe(3);
    });

    it("renders customerInfo mock for auto previewState in editor", () => {
      render(
        <EPCheckoutProvider previewState="auto">
          <span>Preview</span>
        </EPCheckoutProvider>
      );

      const dp = screen.getByTestId("data-provider-checkoutData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.step).toBe("customer_info");
    });
  });

  describe("registration", () => {
    it("has correct meta shape", () => {
      expect(epCheckoutProviderMeta.name).toBe(
        "plasmic-commerce-ep-checkout-provider"
      );
      expect(epCheckoutProviderMeta.displayName).toBe("EP Checkout Provider");
      expect(epCheckoutProviderMeta.providesData).toBe(true);
      expect(epCheckoutProviderMeta.refActions).toBeDefined();
      expect(Object.keys(epCheckoutProviderMeta.refActions)).toEqual(
        expect.arrayContaining([
          "nextStep",
          "previousStep",
          "goToStep",
          "submitCustomerInfo",
          "submitShippingAddress",
          "submitBillingAddress",
          "selectShippingRate",
          "submitPayment",
          "reset",
        ])
      );
    });

    it("registerEPCheckoutProvider calls loader", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPCheckoutProvider(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPCheckoutProvider,
        epCheckoutProviderMeta
      );
    });
  });

describe("EPCheckoutProvider — totals before the order exists", () => {
  const money = (amount: number) => ({
    amount,
    currency: "USD",
    float_price: amount / 100,
    formatted: `$${(amount / 100).toFixed(2)}`,
  });

  afterEach(() => {
    mockCart = null;
    mockCheckoutState = defaultCheckoutState;
  });

  function readSummary() {
    const dp = screen.getByTestId("data-provider-checkoutData");
    return JSON.parse(dp.getAttribute("data-value")!).summary;
  }

  it("reports the cart's money, not zeros", async () => {
    // The order only exists after payment. Building the summary from it alone
    // published "Total $0.00" for the entire flow, beside a cart summary that
    // correctly showed real money.
    mockCart = {
      id: "cart-1",
      itemCount: 2,
      items: [],
      meta: {
        display_price: {
          without_tax: money(3000),
          tax: money(0),
          with_tax: money(3000),
          discount: money(0),
        },
      },
    };

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    const summary = readSummary();
    expect(summary.subtotal).toBe(3000);
    expect(summary.total).toBe(3000);
    expect(summary.subtotalFormatted).toBe("$30.00");
    expect(summary.itemCount).toBe(2);
  });

  it("flags a cart discount so the Discount row renders", async () => {
    // The default rows gate Discount on hasDiscount, a key the summary never
    // set — so the composable path computed a discount and dropped it. EP
    // reports the cart discount as a reduction, hence the sign-agnostic test.
    mockCart = {
      id: "cart-1",
      itemCount: 1,
      items: [],
      meta: {
        display_price: {
          without_tax: money(2500),
          tax: money(0),
          with_tax: money(2500),
          discount: money(-500),
          without_discount: money(3000),
        },
      },
    };

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    const summary = readSummary();
    expect(summary.hasDiscount).toBe(true);
    expect(summary.discount).toBe(-500);
  });

  it("does not flag a discount the cart does not have", async () => {
    mockCart = {
      id: "cart-1",
      itemCount: 1,
      items: [],
      meta: {
        display_price: {
          without_tax: money(2500),
          tax: money(0),
          with_tax: money(2500),
          discount: money(0),
        },
      },
    };

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    expect(readSummary().hasDiscount).toBe(false);
  });

  it("shows the cart's own shipping instead of TBD", async () => {
    // meta.display_price.shipping is what the cart path already reads; the
    // composable summary looked only at the locally selected rate.
    mockCart = {
      id: "cart-1",
      itemCount: 1,
      items: [],
      meta: {
        display_price: {
          without_tax: money(2500),
          tax: money(0),
          with_tax: money(3499),
          discount: money(0),
          shipping: money(999),
        },
      },
    };

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    const summary = readSummary();
    expect(summary.shipping).toBe(999);
    expect(summary.shippingFormatted).toBe("$9.99");
    // with_tax already carries the cart's shipping — adding it again would
    // overstate the total.
    expect(summary.total).toBe(3499);
  });

  it("adds a locally selected rate on top of the cart total", async () => {
    mockCart = {
      id: "cart-1",
      itemCount: 1,
      items: [],
      meta: {
        display_price: {
          without_tax: money(2500),
          tax: money(0),
          with_tax: money(2500),
          discount: money(0),
        },
      },
    };
    mockCheckoutState = {
      currentStep: "shipping",
      isLoading: false,
      selectedShippingRate: {
        id: "rate-1",
        name: "Standard",
        amount: 500,
        currency: "USD",
        service_level: "standard",
      },
    };

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    const summary = readSummary();
    expect(summary.shipping).toBe(500);
    expect(summary.total).toBe(3000);
  });

  it("does not tell a placed order its tax is still pending", async () => {
    // Zero tax on a placed order means zero, not "not calculated yet".
    mockCheckoutState = {
      currentStep: "confirmation",
      isLoading: false,
      order: {
        id: "order-1",
        subtotal: money(2500),
        tax: money(0),
        total: money(2500),
        relationships: { items: { data: [{ id: "item-1" }] } },
      },
    };

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    expect(readSummary().taxFormatted).toBe("$0.00");
  });

  it("still defers tax before the order exists", async () => {
    mockCart = {
      id: "cart-1",
      itemCount: 1,
      items: [],
      meta: {
        display_price: {
          without_tax: money(2500),
          tax: money(0),
          with_tax: money(2500),
          discount: money(0),
        },
      },
    };

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    expect(readSummary().taxFormatted).toBe("Calculated at next step");
  });

  it("still reports zeros when there is no cart at all", async () => {
    mockCart = null;

    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>content</span>
        </EPCheckoutProvider>
      );
    });

    expect(readSummary().total).toBe(0);
  });
});
});
