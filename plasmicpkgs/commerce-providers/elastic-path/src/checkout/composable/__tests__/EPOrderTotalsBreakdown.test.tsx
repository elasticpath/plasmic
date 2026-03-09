/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EPOrderTotalsBreakdown } from "../EPOrderTotalsBreakdown";

describe("EPOrderTotalsBreakdown", () => {
  it("renders children inside a data-ep-order-totals-breakdown element", () => {
    render(
      <EPOrderTotalsBreakdown previewState="withData">
        <span data-testid="child">Totals</span>
      </EPOrderTotalsBreakdown>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    const wrapper = document.querySelector("[data-ep-order-totals-breakdown]");
    expect(wrapper).toBeTruthy();
  });

  it("renders with withData preview state", () => {
    render(
      <EPOrderTotalsBreakdown previewState="withData">
        <span data-testid="totals">$72.91</span>
      </EPOrderTotalsBreakdown>
    );
    expect(screen.getByTestId("totals")).toBeTruthy();
  });

  it("applies className to wrapper div", () => {
    render(
      <EPOrderTotalsBreakdown previewState="withData" className="my-totals">
        <span>Totals</span>
      </EPOrderTotalsBreakdown>
    );
    expect(document.querySelector(".my-totals")).toBeTruthy();
  });

  it("renders without context using fallback mock data", () => {
    // Outside both EPCheckoutProvider and EPCheckoutCartSummary,
    // should use mock data without crashing
    render(
      <EPOrderTotalsBreakdown previewState="auto">
        <span data-testid="fallback">Fallback</span>
      </EPOrderTotalsBreakdown>
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();
  });
});
