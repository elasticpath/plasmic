/** @jest-environment jsdom */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { EPBillingAddressFields } from "../EPBillingAddressFields";

describe("EPBillingAddressFields", () => {
  it("renders children inside a data-ep-billing-address-fields element", () => {
    render(
      <EPBillingAddressFields previewState="sameAsShipping">
        <span data-testid="child">Billing</span>
      </EPBillingAddressFields>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    const wrapper = document.querySelector("[data-ep-billing-address-fields]");
    expect(wrapper).toBeTruthy();
  });

  it("renders with sameAsShipping preview state", () => {
    render(
      <EPBillingAddressFields previewState="sameAsShipping">
        <span data-testid="same">Same</span>
      </EPBillingAddressFields>
    );
    expect(screen.getByTestId("same")).toBeTruthy();
  });

  it("renders with different preview state", () => {
    render(
      <EPBillingAddressFields previewState="different">
        <span data-testid="diff">Different</span>
      </EPBillingAddressFields>
    );
    expect(screen.getByTestId("diff")).toBeTruthy();
  });

  it("renders with withErrors preview state", () => {
    render(
      <EPBillingAddressFields previewState="withErrors">
        <span data-testid="errors">Errors</span>
      </EPBillingAddressFields>
    );
    expect(screen.getByTestId("errors")).toBeTruthy();
  });

  it("applies className to wrapper div", () => {
    render(
      <EPBillingAddressFields previewState="sameAsShipping" className="my-billing">
        <span>Billing</span>
      </EPBillingAddressFields>
    );
    expect(document.querySelector(".my-billing")).toBeTruthy();
  });

  it("exposes no-op refActions when mirroring (auto mode defaults to same-as-shipping)", () => {
    const ref = React.createRef<any>();
    render(
      <EPBillingAddressFields ref={ref} previewState="auto">
        <span>Billing</span>
      </EPBillingAddressFields>
    );
    // In auto mode with no toggle context, defaults to mirroring
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current.setField).toBe("function");
    expect(typeof ref.current.validate).toBe("function");
    expect(typeof ref.current.clear).toBe("function");
    // No-op validate returns true when mirroring
    let result = false;
    act(() => {
      result = ref.current.validate();
    });
    expect(result).toBe(true);
  });
});
