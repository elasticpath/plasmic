/**
 * @jest-environment jsdom
 *
 * CC-2.3 + CC-2.4: EPShippingAddressFields component tests
 *
 * Covers: validation, refActions (setField/validate/clear/useAccountAddress),
 * preview states, className, useAccountAddress copies saved address from
 * shopperContextData.addresses (CC-2.4).
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
const { EPShippingAddressFields } = require("../EPShippingAddressFields");

describe("EPShippingAddressFields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectorValues = {};
  });

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

  it("exposes setField, validate, clear, useAccountAddress via ref", () => {
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
    expect(typeof ref.current.useAccountAddress).toBe("function");
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

  // --- CC-2.4: useAccountAddress copies saved address from shopperContextData ---

  describe("useAccountAddress (CC-2.4)", () => {
    const MOCK_ADDRESSES = [
      {
        id: "addr-home",
        name: "Jane Smith",
        line_1: "123 Main St",
        line_2: "Apt 4B",
        city: "Portland",
        region: "OR",
        postcode: "97201",
        country: "US",
        phone_number: "555-0100",
      },
      {
        id: "addr-work",
        name: "Jane A Smith",
        line_1: "456 Corporate Blvd",
        line_2: "",
        city: "Seattle",
        region: "WA",
        postcode: "98101",
        country: "US",
        phone_number: "555-0200",
      },
    ];

    it("copies address fields when valid addressId is provided", () => {
      mockSelectorValues = {
        shopperContextData: { addresses: MOCK_ADDRESSES },
      };
      const ref = React.createRef<any>();
      render(
        <EPShippingAddressFields ref={ref} previewState="auto">
          <span>Address</span>
        </EPShippingAddressFields>
      );
      act(() => {
        ref.current.useAccountAddress("addr-home");
      });
      const dp = screen.getByTestId("data-provider-shippingAddressFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("Jane");
      expect(data.lastName).toBe("Smith");
      expect(data.line1).toBe("123 Main St");
      expect(data.line2).toBe("Apt 4B");
      expect(data.city).toBe("Portland");
      expect(data.county).toBe("OR"); // mapped from region
      expect(data.postcode).toBe("97201");
      expect(data.country).toBe("US");
      expect(data.phone).toBe("555-0100");
      expect(data.isDirty).toBe(true);
    });

    it("copies second address when different ID is used", () => {
      mockSelectorValues = {
        shopperContextData: { addresses: MOCK_ADDRESSES },
      };
      const ref = React.createRef<any>();
      render(
        <EPShippingAddressFields ref={ref} previewState="auto">
          <span>Address</span>
        </EPShippingAddressFields>
      );
      act(() => {
        ref.current.useAccountAddress("addr-work");
      });
      const dp = screen.getByTestId("data-provider-shippingAddressFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("Jane");
      expect(data.lastName).toBe("A Smith"); // multi-word last name
      expect(data.line1).toBe("456 Corporate Blvd");
      expect(data.city).toBe("Seattle");
      expect(data.county).toBe("WA");
      expect(data.postcode).toBe("98101");
    });

    it("clears errors when copying address", () => {
      mockSelectorValues = {
        shopperContextData: { addresses: MOCK_ADDRESSES },
      };
      const ref = React.createRef<any>();
      render(
        <EPShippingAddressFields ref={ref} previewState="auto">
          <span>Address</span>
        </EPShippingAddressFields>
      );
      // First trigger validation to produce errors
      act(() => {
        ref.current.validate();
      });
      // Now copy an address — errors should clear
      act(() => {
        ref.current.useAccountAddress("addr-home");
      });
      const dp = screen.getByTestId("data-provider-shippingAddressFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.errors.firstName).toBeNull();
      expect(data.errors.line1).toBeNull();
      expect(data.errors.city).toBeNull();
    });

    it("is a no-op when shopperContextData is absent", () => {
      // No shopperContextData set
      const ref = React.createRef<any>();
      render(
        <EPShippingAddressFields ref={ref} previewState="auto">
          <span>Address</span>
        </EPShippingAddressFields>
      );
      act(() => {
        ref.current.useAccountAddress("addr-home");
      });
      // Fields should remain empty
      const dp = screen.getByTestId("data-provider-shippingAddressFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("");
      expect(data.line1).toBe("");
    });

    it("is a no-op when addressId is not found", () => {
      mockSelectorValues = {
        shopperContextData: { addresses: MOCK_ADDRESSES },
      };
      const ref = React.createRef<any>();
      render(
        <EPShippingAddressFields ref={ref} previewState="auto">
          <span>Address</span>
        </EPShippingAddressFields>
      );
      act(() => {
        ref.current.useAccountAddress("addr-nonexistent");
      });
      const dp = screen.getByTestId("data-provider-shippingAddressFieldsData");
      const data = JSON.parse(dp.getAttribute("data-value")!);
      expect(data.firstName).toBe("");
      expect(data.line1).toBe("");
    });

    it("validates successfully after copying a complete address", () => {
      mockSelectorValues = {
        shopperContextData: { addresses: MOCK_ADDRESSES },
      };
      const ref = React.createRef<any>();
      render(
        <EPShippingAddressFields ref={ref} previewState="auto">
          <span>Address</span>
        </EPShippingAddressFields>
      );
      act(() => {
        ref.current.useAccountAddress("addr-home");
      });
      let result = false;
      act(() => {
        result = ref.current.validate();
      });
      expect(result).toBe(true);
    });
  });
});
