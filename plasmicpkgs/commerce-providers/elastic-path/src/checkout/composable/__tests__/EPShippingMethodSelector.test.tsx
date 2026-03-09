/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EPShippingMethodSelector } from "../EPShippingMethodSelector";

describe("EPShippingMethodSelector", () => {
  it("renders children with mock rates in withRates preview state", () => {
    render(
      <EPShippingMethodSelector previewState="withRates">
        <span data-testid="rate">Rate</span>
      </EPShippingMethodSelector>
    );
    // 3 mock rates should produce 3 repeated elements
    const rates = screen.getAllByTestId("rate");
    expect(rates.length).toBe(3);
  });

  it("renders loading content in loading preview state", () => {
    render(
      <EPShippingMethodSelector
        previewState="loading"
        loadingContent={<span data-testid="loading">Loading...</span>}
      >
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(screen.getByTestId("loading")).toBeTruthy();
  });

  it("renders empty content in empty preview state", () => {
    render(
      <EPShippingMethodSelector
        previewState="empty"
        emptyContent={<span data-testid="empty">No rates</span>}
      >
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
  });

  it("renders wrapper with data attribute", () => {
    render(
      <EPShippingMethodSelector previewState="withRates">
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(
      document.querySelector("[data-ep-shipping-method-selector]")
    ).toBeTruthy();
  });

  it("applies className to wrapper", () => {
    render(
      <EPShippingMethodSelector previewState="withRates" className="my-selector">
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(document.querySelector(".my-selector")).toBeTruthy();
  });

  it("exposes selectMethod via ref", () => {
    const ref = React.createRef<any>();
    render(
      <EPShippingMethodSelector ref={ref} previewState="withRates">
        <span>Rate</span>
      </EPShippingMethodSelector>
    );
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current.selectMethod).toBe("function");
  });
});
