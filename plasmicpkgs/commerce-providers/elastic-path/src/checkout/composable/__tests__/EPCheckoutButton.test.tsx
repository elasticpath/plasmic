/**
 * @jest-environment jsdom
 *
 * EPCheckoutButton: always the "Checkout" link to Checkout URL on a page;
 * Preview State shows a step label on the canvas only.
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

  describe("a leftover checkoutData from the page", () => {
    // Nothing in the package publishes checkoutData any more. A page that
    // still has one must not turn the link back into a step button.
    const originalLocation = window.location;

    beforeEach(() => {
      mockCheckoutData = {
        step: "confirmation",
        canProceed: false,
        isProcessing: true,
        order: { id: "order-abc" },
      };
      delete (window as any).location;
      (window as any).location = { assign: jest.fn() } as any;
    });

    afterEach(() => {
      (window as any).location = originalLocation;
    });

    it("still shows the enabled Checkout link", () => {
      const { container } = render(<EPCheckoutButton />);

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      expect(JSON.parse(dp.getAttribute("data-value")!)).toEqual({
        label: "Checkout",
        isDisabled: false,
        isProcessing: false,
        step: "cart",
      });
      const root = container.querySelector("[data-ep-checkout-button]")!;
      expect(root.getAttribute("aria-disabled")).toBeNull();
      expect(root.getAttribute("data-processing")).toBeNull();
    });

    it("still goes to the checkout page and never fires On Complete", () => {
      const onComplete = jest.fn();
      const { container } = render(
        <EPCheckoutButton onComplete={onComplete}>
          <span>Done</span>
        </EPCheckoutButton>
      );

      fireEvent.click(container.querySelector("[data-ep-checkout-button]")!);
      expect(window.location.assign).toHaveBeenCalledWith("/checkout");
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

    it("shows what the published page shows when Preview State is auto", () => {
      const { container } = render(<EPCheckoutButton />);

      expect(
        container.querySelector("[data-ep-checkout-button-label]")?.textContent
      ).toBe("Checkout");
    });
  });

  describe("Preview State on a published page", () => {
    it.each(["customerInfo", "shipping", "payment", "confirmation"])(
      "shows the plain Checkout link for a stored %s preview",
      (previewState) => {
        const { container } = render(
          <EPCheckoutButton previewState={previewState} />
        );

        expect(
          container.querySelector("[data-ep-checkout-button-label]")
            ?.textContent
        ).toBe("Checkout");
      }
    );

    it("still goes to the checkout page", () => {
      const originalLocation = window.location;
      delete (window as any).location;
      (window as any).location = { assign: jest.fn() } as any;
      try {
        const { container } = render(
          <EPCheckoutButton previewState="payment" />
        );
        fireEvent.click(container.querySelector("[data-ep-checkout-button]")!);
        expect(window.location.assign).toHaveBeenCalledWith("/checkout");
      } finally {
        (window as any).location = originalLocation;
      }
    });
  });

  it("applies className to root element", () => {
    const { container } = render(
      <EPCheckoutButton className="my-button">
        <span>Button</span>
      </EPCheckoutButton>
    );

    const root = container.querySelector("[data-ep-checkout-button]");
    expect(root?.className).toContain("my-button");
  });

  describe("registration", () => {
    it("renders the Checkout label when the slot is empty", () => {
      const { container } = render(<EPCheckoutButton />);

      expect(container.textContent).toContain("Checkout");
    });

    it("ships no label of its own, so buttonData.label shows through", () => {
      // The default read "Continue" while a standalone button's label is
      // "Checkout", so a cart page contradicted itself unless the designer
      // bound the label.
      const slot = (epCheckoutButtonMeta.props as any).children;

      expect(slot.defaultValue).toBeUndefined();
      expect(slot.hidePlaceholder).toBe(true);
    });

    it("describes the link to the checkout page, not a step-aware button", () => {
      const texts = [
        epCheckoutButtonMeta.description,
        ...Object.values<any>(epCheckoutButtonMeta.props).map(
          (p) => p.description ?? ""
        ),
      ].join("\n");

      expect(texts).not.toMatch(/step-aware/i);
      expect(texts).not.toMatch(/outside an EP Checkout Provider/i);
      expect(epCheckoutButtonMeta.description).toMatch(/checkout page/i);
      expect(
        (epCheckoutButtonMeta.props as any).onComplete.description
      ).toMatch(/^Deprecated — ignored\./);
      expect(
        (epCheckoutButtonMeta.props as any).previewState.description
      ).toMatch(/^Editor only\./);
    });

    it("hides the deprecated On Complete and keeps it off Studio's Interactions section", () => {
      const onComplete = (epCheckoutButtonMeta.props as any).onComplete;
      expect(onComplete.hidden()).toBe(true);
      expect(onComplete.advanced).toBe(true);
    });

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

  describe("on a page", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      mockCheckoutData = undefined;
      delete (window as any).location;
      (window as any).location = { assign: jest.fn() } as any;
    });

    afterEach(() => {
      (window as any).location = originalLocation;
    });

    it("is enabled and labelled for the cart", () => {
      render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const dp = screen.getByTestId("data-provider-checkoutButtonData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.isDisabled).toBe(false);
      expect(data.label).toBe("Checkout");
      expect(data.step).toBe("cart");
    });

    it("navigates to the checkout page on click", () => {
      const { container } = render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      fireEvent.click(container.querySelector("[data-ep-checkout-button]")!);
      expect(window.location.assign).toHaveBeenCalledWith("/checkout");
    });

    it("navigates on Enter and Space, like any other control", () => {
      const { container } = render(
        <EPCheckoutButton>
          <span>Button</span>
        </EPCheckoutButton>
      );

      const el = container.querySelector("[data-ep-checkout-button]")!;
      fireEvent.keyDown(el, { key: "Enter" });
      expect(window.location.assign).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(el, { key: " " });
      expect(window.location.assign).toHaveBeenCalledTimes(2);
    });

    it("honours a custom checkout URL", () => {
      const { container } = render(
        <EPCheckoutButton checkoutUrl="/basket/checkout">
          <span>Button</span>
        </EPCheckoutButton>
      );

      fireEvent.click(container.querySelector("[data-ep-checkout-button]")!);
      expect(window.location.assign).toHaveBeenCalledWith("/basket/checkout");
    });
  });
});
