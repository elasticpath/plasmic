/** @jest-environment jsdom */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { EPShippingAddressFields } from "../EPShippingAddressFields";

describe("EPShippingAddressFields", () => {
  it("renders children inside a data-ep-shipping-address-fields element", () => {
    render(
      <EPShippingAddressFields previewState="filled">
        <span data-testid="child">Address</span>
      </EPShippingAddressFields>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    const wrapper = document.querySelector("[data-ep-shipping-address-fields]");
    expect(wrapper).toBeTruthy();
  });

  it("renders with empty preview state", () => {
    render(
      <EPShippingAddressFields previewState="empty">
        <span data-testid="empty">Empty</span>
      </EPShippingAddressFields>
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
  });

  it("renders with withErrors preview state", () => {
    render(
      <EPShippingAddressFields previewState="withErrors">
        <span data-testid="errors">Errors</span>
      </EPShippingAddressFields>
    );
    expect(screen.getByTestId("errors")).toBeTruthy();
  });

  it("renders with withSuggestions preview state", () => {
    render(
      <EPShippingAddressFields previewState="withSuggestions">
        <span data-testid="suggestions">Suggestions</span>
      </EPShippingAddressFields>
    );
    expect(screen.getByTestId("suggestions")).toBeTruthy();
  });

  it("applies className to wrapper div", () => {
    render(
      <EPShippingAddressFields previewState="filled" className="my-address">
        <span>Address</span>
      </EPShippingAddressFields>
    );
    expect(document.querySelector(".my-address")).toBeTruthy();
  });

  it("exposes setField, validate, clear via ref", () => {
    const ref = React.createRef<any>();
    render(
      <EPShippingAddressFields ref={ref} previewState="auto">
        <span>Address</span>
      </EPShippingAddressFields>
    );
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current.setField).toBe("function");
    expect(typeof ref.current.validate).toBe("function");
    expect(typeof ref.current.clear).toBe("function");
  });

  it("validate returns false for empty fields", () => {
    const ref = React.createRef<any>();
    render(
      <EPShippingAddressFields ref={ref} previewState="auto">
        <span>Address</span>
      </EPShippingAddressFields>
    );
    let result = true;
    act(() => {
      result = ref.current.validate();
    });
    expect(result).toBe(false);
  });

  it("validate returns true after setting valid US address", () => {
    const ref = React.createRef<any>();
    render(
      <EPShippingAddressFields ref={ref} previewState="auto">
        <span>Address</span>
      </EPShippingAddressFields>
    );
    act(() => {
      ref.current.setField("firstName", "Jane");
      ref.current.setField("lastName", "Smith");
      ref.current.setField("line1", "123 Main St");
      ref.current.setField("city", "Portland");
      ref.current.setField("postcode", "97201");
      ref.current.setField("country", "US");
      ref.current.setField("phone", "555-0100");
    });
    let result = false;
    act(() => {
      result = ref.current.validate();
    });
    expect(result).toBe(true);
  });

  it("validate catches invalid US ZIP code", () => {
    const ref = React.createRef<any>();
    render(
      <EPShippingAddressFields ref={ref} previewState="auto">
        <span>Address</span>
      </EPShippingAddressFields>
    );
    act(() => {
      ref.current.setField("firstName", "Jane");
      ref.current.setField("lastName", "Smith");
      ref.current.setField("line1", "123 Main St");
      ref.current.setField("city", "Portland");
      ref.current.setField("postcode", "INVALID");
      ref.current.setField("country", "US");
      ref.current.setField("phone", "555-0100");
    });
    let result = true;
    act(() => {
      result = ref.current.validate();
    });
    expect(result).toBe(false);
  });
});
