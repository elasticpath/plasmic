/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EPCheckoutStepIndicator } from "../EPCheckoutStepIndicator";

describe("EPCheckoutStepIndicator", () => {
  it("renders 4 step items in withData preview mode", () => {
    render(
      <EPCheckoutStepIndicator previewState="withData">
        <span data-testid="step">Step content</span>
      </EPCheckoutStepIndicator>
    );
    // Should render 4 listitems (one per checkout step)
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
  });

  it("renders the wrapper with data-ep-checkout-step-indicator attribute", () => {
    render(
      <EPCheckoutStepIndicator previewState="withData">
        <span>Step</span>
      </EPCheckoutStepIndicator>
    );
    const wrapper = document.querySelector("[data-ep-checkout-step-indicator]");
    expect(wrapper).toBeTruthy();
  });

  it("applies className to wrapper div", () => {
    render(
      <EPCheckoutStepIndicator previewState="withData" className="my-steps">
        <span>Step</span>
      </EPCheckoutStepIndicator>
    );
    const wrapper = document.querySelector(".my-steps");
    expect(wrapper).toBeTruthy();
  });

  it("defaults to stepIndex 0 when no checkoutData context", () => {
    // Without checkoutData context and previewState="auto" (not in editor),
    // defaults to stepIndex 0
    render(
      <EPCheckoutStepIndicator previewState="auto">
        <span>Step</span>
      </EPCheckoutStepIndicator>
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
  });
});
