/**
 * @jest-environment jsdom
 *
 * CC-1.2: EPCheckoutStepIndicator component tests
 *
 * Covers: repeats children 4 times, exposes currentStep DataProvider per
 * iteration with isActive/isCompleted/isFuture, design-time mock rendering,
 * className application, and registration metadata.
 */

// Track useSelector calls
let mockCheckoutData: any = undefined;

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  repeatedElement: (i: number, children: React.ReactNode) => (
    <div data-testid={`repeated-${i}`}>{children}</div>
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
import { render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPCheckoutStepIndicator,
  registerEPCheckoutStepIndicator,
  epCheckoutStepIndicatorMeta,
} = require("../EPCheckoutStepIndicator");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePlasmicCanvasContext } = require("@plasmicapp/host");

describe("EPCheckoutStepIndicator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckoutData = undefined;
    (usePlasmicCanvasContext as jest.Mock).mockReturnValue(false);
  });

  it("renders 4 repeated elements", () => {
    mockCheckoutData = { stepIndex: 0 };

    render(
      <EPCheckoutStepIndicator>
        <span>Step template</span>
      </EPCheckoutStepIndicator>
    );

    expect(screen.getByTestId("repeated-0")).toBeTruthy();
    expect(screen.getByTestId("repeated-1")).toBeTruthy();
    expect(screen.getByTestId("repeated-2")).toBeTruthy();
    expect(screen.getByTestId("repeated-3")).toBeTruthy();
  });

  it("exposes currentStep DataProvider per iteration", () => {
    mockCheckoutData = { stepIndex: 1 }; // Shipping active

    render(
      <EPCheckoutStepIndicator>
        <span>Step template</span>
      </EPCheckoutStepIndicator>
    );

    const providers = screen.getAllByTestId("data-provider-currentStep");
    expect(providers).toHaveLength(4);

    // Step 0: Customer Info — completed (stepIndex > 0)
    const step0 = JSON.parse(providers[0].getAttribute("data-value")!);
    expect(step0.name).toBe("Customer Info");
    expect(step0.stepKey).toBe("customer_info");
    expect(step0.index).toBe(0);
    expect(step0.isActive).toBe(false);
    expect(step0.isCompleted).toBe(true);
    expect(step0.isFuture).toBe(false);

    // Step 1: Shipping — active
    const step1 = JSON.parse(providers[1].getAttribute("data-value")!);
    expect(step1.name).toBe("Shipping");
    expect(step1.stepKey).toBe("shipping");
    expect(step1.isActive).toBe(true);
    expect(step1.isCompleted).toBe(false);
    expect(step1.isFuture).toBe(false);

    // Step 2: Payment — future
    const step2 = JSON.parse(providers[2].getAttribute("data-value")!);
    expect(step2.name).toBe("Payment");
    expect(step2.isFuture).toBe(true);
    expect(step2.isActive).toBe(false);

    // Step 3: Confirmation — future
    const step3 = JSON.parse(providers[3].getAttribute("data-value")!);
    expect(step3.name).toBe("Confirmation");
    expect(step3.isFuture).toBe(true);
  });

  it("defaults stepIndex to 0 when no checkoutData context", () => {
    mockCheckoutData = undefined;

    render(
      <EPCheckoutStepIndicator>
        <span>Step template</span>
      </EPCheckoutStepIndicator>
    );

    const providers = screen.getAllByTestId("data-provider-currentStep");
    const step0 = JSON.parse(providers[0].getAttribute("data-value")!);
    expect(step0.isActive).toBe(true);
    expect(step0.isCompleted).toBe(false);
  });

  it("applies className to root element", () => {
    mockCheckoutData = { stepIndex: 0 };

    const { container } = render(
      <EPCheckoutStepIndicator className="my-steps">
        <span>Step</span>
      </EPCheckoutStepIndicator>
    );

    const root = container.querySelector(
      "[data-ep-checkout-step-indicator]"
    );
    expect(root?.className).toContain("my-steps");
  });

  it("uses mock data when previewState=withData", () => {
    (usePlasmicCanvasContext as jest.Mock).mockReturnValue(true);

    render(
      <EPCheckoutStepIndicator previewState="withData">
        <span>Step</span>
      </EPCheckoutStepIndicator>
    );

    const providers = screen.getAllByTestId("data-provider-currentStep");
    expect(providers).toHaveLength(4);

    // Mock has Shipping active (index 1)
    const step1 = JSON.parse(providers[1].getAttribute("data-value")!);
    expect(step1.isActive).toBe(true);
    expect(step1.name).toBe("Shipping");
  });

  it("uses mock data in editor when no checkoutData context", () => {
    (usePlasmicCanvasContext as jest.Mock).mockReturnValue(true);
    mockCheckoutData = undefined;

    render(
      <EPCheckoutStepIndicator>
        <span>Step</span>
      </EPCheckoutStepIndicator>
    );

    const providers = screen.getAllByTestId("data-provider-currentStep");
    // Mock has Shipping active (index 1)
    const step1 = JSON.parse(providers[1].getAttribute("data-value")!);
    expect(step1.isActive).toBe(true);
  });

  describe("registration", () => {
    it("has correct meta shape", () => {
      expect(epCheckoutStepIndicatorMeta.name).toBe(
        "plasmic-commerce-ep-checkout-step-indicator"
      );
      expect(epCheckoutStepIndicatorMeta.displayName).toBe(
        "EP Checkout Step Indicator"
      );
      expect(epCheckoutStepIndicatorMeta.providesData).toBe(true);
      expect(epCheckoutStepIndicatorMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-checkout-provider"
      );
    });

    it("registerEPCheckoutStepIndicator calls loader", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPCheckoutStepIndicator(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPCheckoutStepIndicator,
        epCheckoutStepIndicatorMeta
      );
    });
  });

  describe("with an empty slot", () => {
    it("names each step instead of repeating placeholder words", () => {
      // The default was the literal words "Step" and "Name", once per step.
      const { container } = render(<EPCheckoutStepIndicator />);

      const steps = container.querySelectorAll("[data-ep-step]");
      expect(steps).toHaveLength(4);
      const names = [...container.querySelectorAll("[data-ep-step-name]")].map(
        (n) => n.textContent
      );
      expect(names).not.toContain("Name");
      expect(names.every((n) => !!n && n.length > 1)).toBe(true);
      expect(
        [...container.querySelectorAll("[data-ep-step-number]")].map(
          (n) => n.textContent
        )
      ).toEqual(["1", "2", "3", "4"]);
    });

    it("marks which step the shopper is on", () => {
      const { container } = render(<EPCheckoutStepIndicator />);

      const active = container.querySelectorAll('[data-state="active"]');
      expect(active).toHaveLength(1);
      expect(active[0].getAttribute("aria-current")).toBe("step");
    });

    it("leaves the slot content alone when there is any", () => {
      const { container } = render(
        <EPCheckoutStepIndicator>
          <span data-testid="mine">mine</span>
        </EPCheckoutStepIndicator>
      );

      expect(container.querySelectorAll("[data-ep-step]")).toHaveLength(0);
    });
  });
});
