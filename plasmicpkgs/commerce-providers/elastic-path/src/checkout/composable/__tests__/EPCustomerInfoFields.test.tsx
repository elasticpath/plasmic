/**
 * @jest-environment jsdom
 *
 * CC-2.1 + CC-2.2: EPCustomerInfoFields component tests
 *
 * Covers: validation, refActions (setField/validate/clear), preview states,
 * className, pre-population from shopperContextData account profile (CC-2.2).
 */

let mockSelectorValues: Record<string, any> = {};

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  useSelector: jest.fn((key: string) => mockSelectorValues[key]),
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen, act } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCustomerInfoFields } = require("../EPCustomerInfoFields");

describe("EPCustomerInfoFields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectorValues = {};
  });

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

  // --- CC-2.2: shopperContextData account profile pre-population ---

  describe("shopperContextData pre-population (CC-2.2)", () => {
    it("pre-populates from shopperContextData account profile when no other sources", () => {
      mockSelectorValues = {
        shopperContextData: {
          account: { name: "Alice Wonderland", email: "alice@example.com" },
        },
      };
      const ref = React.createRef<any>();
      render(
        <EPCustomerInfoFields ref={ref} previewState="auto">
          <span>Form</span>
        </EPCustomerInfoFields>
      );
      // Verify via DataProvider — the data-value contains the pre-populated fields
      const dp = screen.getByTestId("data-provider-customerInfoFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("Alice");
      expect(data.lastName).toBe("Wonderland");
      expect(data.email).toBe("alice@example.com");
    });

    it("splits multi-word name correctly from shopperContextData", () => {
      mockSelectorValues = {
        shopperContextData: {
          account: { name: "Mary Jane Watson", email: "mj@example.com" },
        },
      };
      const ref = React.createRef<any>();
      render(
        <EPCustomerInfoFields ref={ref} previewState="auto">
          <span>Form</span>
        </EPCustomerInfoFields>
      );
      const dp = screen.getByTestId("data-provider-customerInfoFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("Mary");
      expect(data.lastName).toBe("Jane Watson");
    });

    it("checkoutData takes priority over shopperContextData", () => {
      mockSelectorValues = {
        checkoutData: {
          customerInfo: { firstName: "Bob", lastName: "Builder", email: "bob@example.com" },
        },
        shopperContextData: {
          account: { name: "Alice Wonderland", email: "alice@example.com" },
        },
      };
      const ref = React.createRef<any>();
      render(
        <EPCustomerInfoFields ref={ref} previewState="auto">
          <span>Form</span>
        </EPCustomerInfoFields>
      );
      const dp = screen.getByTestId("data-provider-customerInfoFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      // checkoutData wins — not shopperContextData
      expect(data.firstName).toBe("Bob");
      expect(data.lastName).toBe("Builder");
      expect(data.email).toBe("bob@example.com");
    });

    it("handles shopperContextData with email only (no name)", () => {
      mockSelectorValues = {
        shopperContextData: {
          account: { email: "noname@example.com" },
        },
      };
      render(
        <EPCustomerInfoFields previewState="auto">
          <span>Form</span>
        </EPCustomerInfoFields>
      );
      const dp = screen.getByTestId("data-provider-customerInfoFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("");
      expect(data.lastName).toBe("");
      expect(data.email).toBe("noname@example.com");
    });

    it("ignores shopperContextData when account is null", () => {
      mockSelectorValues = {
        shopperContextData: { account: null },
      };
      const ref = React.createRef<any>();
      render(
        <EPCustomerInfoFields ref={ref} previewState="auto">
          <span>Form</span>
        </EPCustomerInfoFields>
      );
      // Should still render runtime with empty fields
      const dp = screen.getByTestId("data-provider-customerInfoFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("");
      expect(data.email).toBe("");
    });
  });
});
