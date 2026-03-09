/** @jest-environment jsdom */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { EPCustomerInfoFields } from "../EPCustomerInfoFields";

describe("EPCustomerInfoFields", () => {
  it("renders children inside a data-ep-customer-info-fields element", () => {
    render(
      <EPCustomerInfoFields previewState="filled">
        <span data-testid="child">Name</span>
      </EPCustomerInfoFields>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    const wrapper = document.querySelector("[data-ep-customer-info-fields]");
    expect(wrapper).toBeTruthy();
  });

  it("renders with empty preview state", () => {
    render(
      <EPCustomerInfoFields previewState="empty">
        <span data-testid="empty">Empty</span>
      </EPCustomerInfoFields>
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
  });

  it("renders with withErrors preview state", () => {
    render(
      <EPCustomerInfoFields previewState="withErrors">
        <span data-testid="errors">Errors</span>
      </EPCustomerInfoFields>
    );
    expect(screen.getByTestId("errors")).toBeTruthy();
  });

  it("applies className to wrapper div", () => {
    render(
      <EPCustomerInfoFields previewState="filled" className="my-form">
        <span>Form</span>
      </EPCustomerInfoFields>
    );
    expect(document.querySelector(".my-form")).toBeTruthy();
  });

  it("exposes setField, validate, clear via ref", () => {
    const ref = React.createRef<any>();
    render(
      <EPCustomerInfoFields ref={ref} previewState="auto">
        <span>Form</span>
      </EPCustomerInfoFields>
    );
    // In auto mode with no context, renders runtime which exposes refActions
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current.setField).toBe("function");
    expect(typeof ref.current.validate).toBe("function");
    expect(typeof ref.current.clear).toBe("function");
  });

  it("validate returns false for empty fields", () => {
    const ref = React.createRef<any>();
    render(
      <EPCustomerInfoFields ref={ref} previewState="auto">
        <span>Form</span>
      </EPCustomerInfoFields>
    );
    let result: boolean = true;
    act(() => {
      result = ref.current.validate();
    });
    expect(result).toBe(false);
  });

  it("validate returns true after setting valid fields", () => {
    const ref = React.createRef<any>();
    render(
      <EPCustomerInfoFields ref={ref} previewState="auto">
        <span>Form</span>
      </EPCustomerInfoFields>
    );
    act(() => {
      ref.current.setField("firstName", "Jane");
      ref.current.setField("lastName", "Smith");
      ref.current.setField("email", "jane@example.com");
    });
    let result: boolean = false;
    act(() => {
      result = ref.current.validate();
    });
    expect(result).toBe(true);
  });

  it("validate catches invalid email", () => {
    const ref = React.createRef<any>();
    render(
      <EPCustomerInfoFields ref={ref} previewState="auto">
        <span>Form</span>
      </EPCustomerInfoFields>
    );
    act(() => {
      ref.current.setField("firstName", "Jane");
      ref.current.setField("lastName", "Smith");
      ref.current.setField("email", "not-an-email");
    });
    let result: boolean = true;
    act(() => {
      result = ref.current.validate();
    });
    expect(result).toBe(false);
  });
});
