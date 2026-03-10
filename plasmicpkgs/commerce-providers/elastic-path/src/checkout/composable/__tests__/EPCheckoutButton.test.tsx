/**
 * @jest-environment jsdom
 *
 * CC-1.3: EPCheckoutButton component tests
 *
 * Covers: derives label from step, exposes checkoutButtonData DataProvider,
 * isDisabled reflects processing/canProceed state, design-time preview,
 * onComplete fires on confirmation step, className application, registration.
 */

let mockCheckoutData: any = undefined;

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  useSelector: jest.fn((key: string) => {
    if (key === "checkoutData") return mockCheckoutData;
    return undefined;
  }),
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPCheckoutButton,
  registerEPCheckoutButton,
  epCheckoutButtonMeta,
} = require("../EPCheckoutButton");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePlasmicCanvasContext } = require("@plasmicapp/host");

describe("EPCheckoutButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckoutData = undefined;
    (usePlasmicCanvasContext as jest.Mock).mockReturnValue(false);
  });

  describe("step label derivation", () => {
    it("shows 'Continue to Shipping' on customer_info step", () => {
      mockCheckoutData = {
        step: "customer_info",
        canProceed: true,
        isProcessing: false,
      };

      render(
        <EPCheckoutButton>
          <span data-testid="child">Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.label).toBe("Continue to Shipping");
      expect(data.step).toBe("customer_info");
    });

    it("shows 'Continue to Payment' on shipping step", () => {
      mockCheckoutData = {
        step: "shipping",
        canProceed: true,
        isProcessing: false,
      };

      render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.label).toBe("Continue to Payment");
    });

    it("shows 'Place Order' on payment step", () => {
      mockCheckoutData = {
        step: "payment",
        canProceed: true,
        isProcessing: false,
      };

      render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.label).toBe("Place Order");
    });

    it("shows 'Done' on confirmation step", () => {
      mockCheckoutData = {
        step: "confirmation",
        canProceed: false,
        isProcessing: false,
        order: { id: "order-1" },
      };

      render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.label).toBe("Done");
    });
  });

  describe("isDisabled state", () => {
    it("isDisabled true when isProcessing", () => {
      mockCheckoutData = {
        step: "customer_info",
        canProceed: true,
        isProcessing: true,
      };

      render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.isDisabled).toBe(true);
      expect(data.isProcessing).toBe(true);
    });

    it("isDisabled true when canProceed is false", () => {
      mockCheckoutData = {
        step: "customer_info",
        canProceed: false,
        isProcessing: false,
      };

      render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.isDisabled).toBe(true);
    });

    it("isDisabled false when canProceed is true and not processing", () => {
      mockCheckoutData = {
        step: "shipping",
        canProceed: true,
        isProcessing: false,
      };

      render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.isDisabled).toBe(false);
    });
  });

  describe("onComplete event", () => {
    it("fires onComplete with orderId on confirmation step click", () => {
      mockCheckoutData = {
        step: "confirmation",
        canProceed: true,
        isProcessing: false,
        order: { id: "order-abc" },
      };
      const onComplete = jest.fn();

      const { container } = render(
        <EPCheckoutButton onComplete={onComplete}>
          <span>Done</span>
        </EPCheckoutButton>
      );

      const button = container.querySelector("[data-ep-checkout-button]")!;
      fireEvent.click(button);
      expect(onComplete).toHaveBeenCalledWith({ orderId: "order-abc" });
    });

    it("does not fire onComplete on non-confirmation steps", () => {
      mockCheckoutData = {
        step: "customer_info",
        canProceed: true,
        isProcessing: false,
      };
      const onComplete = jest.fn();

      const { container } = render(
        <EPCheckoutButton onComplete={onComplete}>
          <span>Continue</span>
        </EPCheckoutButton>
      );

      const button = container.querySelector("[data-ep-checkout-button]")!;
      fireEvent.click(button);
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe("design-time preview", () => {
    beforeEach(() => {
      (usePlasmicCanvasContext as jest.Mock).mockReturnValue(true);
    });

    it("renders mock for previewState=customerInfo", () => {
      render(
        <EPCheckoutButton previewState="customerInfo">
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.label).toBe("Continue to Shipping");
      expect(data.isDisabled).toBe(false);
    });

    it("renders mock for previewState=payment", () => {
      render(
        <EPCheckoutButton previewState="payment">
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.label).toBe("Place Order");
    });
  });

  it("applies className to root element", () => {
    mockCheckoutData = {
      step: "customer_info",
      canProceed: false,
      isProcessing: false,
    };

    const { container } = render(
      <EPCheckoutButton className="my-button">
        <span>Button</span>
      </EPCheckoutButton>
    );

    const root = container.querySelector("[data-ep-checkout-button]");
    expect(root?.className).toContain("my-button");
  });

  describe("registration", () => {
    it("has correct meta shape", () => {
      expect(epCheckoutButtonMeta.name).toBe(
        "plasmic-commerce-ep-checkout-button"
      );
      expect(epCheckoutButtonMeta.displayName).toBe("EP Checkout Button");
      expect(epCheckoutButtonMeta.providesData).toBe(true);
    });

    it("registerEPCheckoutButton calls loader", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPCheckoutButton(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPCheckoutButton,
        epCheckoutButtonMeta
      );
    });
  });
});
