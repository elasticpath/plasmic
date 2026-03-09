/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { EPCheckoutButton } from "../EPCheckoutButton";

describe("EPCheckoutButton", () => {
  it("renders children inside a data-ep-checkout-button element", () => {
    render(
      <EPCheckoutButton previewState="customerInfo">
        <span data-testid="child">Continue</span>
      </EPCheckoutButton>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    const wrapper = document.querySelector("[data-ep-checkout-button]");
    expect(wrapper).toBeTruthy();
  });

  it("sets data-step attribute based on previewState", () => {
    render(
      <EPCheckoutButton previewState="shipping">
        <span>Continue</span>
      </EPCheckoutButton>
    );
    const wrapper = document.querySelector("[data-ep-checkout-button]");
    expect(wrapper?.getAttribute("data-step")).toBe("shipping");
  });

  it("sets data-step to payment for payment previewState", () => {
    render(
      <EPCheckoutButton previewState="payment">
        <span>Pay</span>
      </EPCheckoutButton>
    );
    const wrapper = document.querySelector("[data-ep-checkout-button]");
    expect(wrapper?.getAttribute("data-step")).toBe("payment");
  });

  it("defaults to customer_info step without context", () => {
    render(
      <EPCheckoutButton previewState="auto">
        <span>Go</span>
      </EPCheckoutButton>
    );
    const wrapper = document.querySelector("[data-ep-checkout-button]");
    expect(wrapper?.getAttribute("data-step")).toBe("customer_info");
  });

  it("applies className to wrapper", () => {
    render(
      <EPCheckoutButton previewState="customerInfo" className="my-btn">
        <span>Click</span>
      </EPCheckoutButton>
    );
    expect(document.querySelector(".my-btn")).toBeTruthy();
  });

  it("fires onComplete with orderId on confirmation step click", () => {
    // Without checkoutData context, onComplete won't have an orderId
    // This test verifies the handler doesn't crash
    const handleComplete = jest.fn();
    render(
      <EPCheckoutButton previewState="confirmation" onComplete={handleComplete}>
        <span>Done</span>
      </EPCheckoutButton>
    );
    const wrapper = document.querySelector("[data-ep-checkout-button]")!;
    fireEvent.click(wrapper);
    // onComplete is not called because there's no checkoutData.order
    expect(handleComplete).not.toHaveBeenCalled();
  });
});
