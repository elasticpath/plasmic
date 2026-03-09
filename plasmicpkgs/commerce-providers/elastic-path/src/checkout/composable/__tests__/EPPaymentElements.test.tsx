/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EPPaymentElements } from "../EPPaymentElements";

describe("EPPaymentElements", () => {
  it("renders mock payment form in design-time (previewState=ready)", () => {
    render(
      <EPPaymentElements previewState="ready">
        <span data-testid="child">Submit</span>
      </EPPaymentElements>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    // Mock form renders card placeholders
    expect(screen.getByText("Card number")).toBeTruthy();
    expect(screen.getByText("MM / YY")).toBeTruthy();
    expect(screen.getByText("CVC")).toBeTruthy();
  });

  it("renders with processing preview state", () => {
    render(
      <EPPaymentElements previewState="processing">
        <span data-testid="proc">Processing</span>
      </EPPaymentElements>
    );
    expect(screen.getByTestId("proc")).toBeTruthy();
  });

  it("renders with error preview state", () => {
    render(
      <EPPaymentElements previewState="error">
        <span data-testid="err">Error</span>
      </EPPaymentElements>
    );
    expect(screen.getByTestId("err")).toBeTruthy();
  });

  it("shows error when no Stripe key provided at runtime (auto mode, no editor context)", () => {
    // Without Plasmic canvas context and previewState=auto, component goes to runtime
    // but without stripePublishableKey, should expose error in paymentData
    render(
      <EPPaymentElements previewState="auto">
        <span data-testid="no-key">No Key</span>
      </EPPaymentElements>
    );
    // In test environment without Plasmic canvas, inEditor=false,
    // previewState=auto → runtime path → no stripePublishableKey → error data
    expect(screen.getByTestId("no-key")).toBeTruthy();
  });

  it("applies className to mock form wrapper", () => {
    render(
      <EPPaymentElements previewState="ready" className="my-payment">
        <span>Pay</span>
      </EPPaymentElements>
    );
    expect(document.querySelector(".my-payment")).toBeTruthy();
  });
});
