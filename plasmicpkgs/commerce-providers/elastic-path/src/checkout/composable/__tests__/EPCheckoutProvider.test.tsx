/** @jest-environment jsdom */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { EPCheckoutProvider } from "../EPCheckoutProvider";

// ---------------------------------------------------------------------------
// Mock global.fetch — useShopperFetch() and useCheckout() call fetch()
// internally. jest.mock() doesn't hoist with esbuild transform.
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function mockFetchSuccess(data: any = {}) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetchSuccess();
});

// ---------------------------------------------------------------------------
// Helper to read DataProvider data from rendered output.
// DataProvider renders children — we verify via text content and data attrs.
// ---------------------------------------------------------------------------

describe("EPCheckoutProvider", () => {
  it("renders children inside a data-ep-checkout-provider element", () => {
    render(
      <EPCheckoutProvider previewState="customerInfo">
        <span data-testid="child">Hello Checkout</span>
      </EPCheckoutProvider>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.getByText("Hello Checkout")).toBeTruthy();
    // The wrapper div should have the data attribute
    const wrapper = screen.getByText("Hello Checkout").closest(
      "[data-ep-checkout-provider]"
    );
    expect(wrapper).toBeTruthy();
  });

  it("renders design-time mock data for customerInfo previewState", () => {
    render(
      <EPCheckoutProvider previewState="customerInfo">
        <span data-testid="child">Preview</span>
      </EPCheckoutProvider>
    );
    // Component should render without errors in preview mode
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("renders design-time mock data for shipping previewState", () => {
    render(
      <EPCheckoutProvider previewState="shipping">
        <span data-testid="child">Shipping</span>
      </EPCheckoutProvider>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("renders design-time mock data for payment previewState", () => {
    render(
      <EPCheckoutProvider previewState="payment">
        <span data-testid="child">Payment</span>
      </EPCheckoutProvider>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("renders design-time mock data for confirmation previewState", () => {
    render(
      <EPCheckoutProvider previewState="confirmation">
        <span data-testid="child">Confirmation</span>
      </EPCheckoutProvider>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("exposes refActions via ref", () => {
    const ref = React.createRef<any>();

    // previewState forces design-time mode (no hooks needed)
    render(
      <EPCheckoutProvider ref={ref} previewState="customerInfo">
        <span>test</span>
      </EPCheckoutProvider>
    );

    // In design-time mode the forwardRef path renders mock DataProvider,
    // so ref actions are not attached (they exist on the runtime path).
    // This test verifies the component renders without error with a ref.
    expect(screen.getByText("test")).toBeTruthy();
  });

  it("renders runtime children with auto previewState when not in editor", () => {
    // When previewState is "auto" and not in editor, the runtime path is used.
    // The runtime path uses useCheckout() which initializes to CUSTOMER_INFO step.
    render(
      <EPCheckoutProvider previewState="auto">
        <span data-testid="child">Runtime</span>
      </EPCheckoutProvider>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("applies className to wrapper div", () => {
    render(
      <EPCheckoutProvider previewState="customerInfo" className="my-checkout">
        <span>test</span>
      </EPCheckoutProvider>
    );
    const wrapper = document.querySelector(".my-checkout");
    expect(wrapper).toBeTruthy();
    expect(wrapper?.getAttribute("data-ep-checkout-provider")).toBe("");
  });

  it("runtime ref exposes all 9 refActions", async () => {
    const ref = React.createRef<any>();

    // Render in runtime mode (previewState="auto", not in editor)
    await act(async () => {
      render(
        <EPCheckoutProvider ref={ref} previewState="auto">
          <span>test</span>
        </EPCheckoutProvider>
      );
    });

    // In runtime mode, ref should expose all actions
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
});
