/**
 * @jest-environment jsdom
 */
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name }: any) => (
    <div data-testid={`data-provider-${name}`}>{children}</div>
  ),
  repeatedElement: (_i: number, children: React.ReactNode) => children,
  useSelector: jest.fn().mockReturnValue(undefined),
  usePlasmicCanvasContext: (...args: any[]) =>
    mockUsePlasmicCanvasContext(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPCheckoutStepIndicator,
  registerEPCheckoutStepIndicator,
  epCheckoutStepIndicatorMeta,
} = require("../EPCheckoutStepIndicator");

describe("EPCheckoutStepIndicator (deprecated)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it.each([
    ["on a page", false, "auto"],
    ["on the Studio canvas", true, "auto"],
    ["with sample data forced", true, "withData"],
  ])("renders nothing %s", (_where, inEditor, previewState) => {
    mockUsePlasmicCanvasContext.mockReturnValue(inEditor);
    const { container } = render(
      <EPCheckoutStepIndicator className="steps" previewState={previewState}>
        <span>step</span>
      </EPCheckoutStepIndicator>
    );

    expect(container.innerHTML).toBe("");
  });

  describe("registration", () => {
    it("stays registered under its name, labelled deprecated, pointing to the session checkout", () => {
      expect(epCheckoutStepIndicatorMeta.name).toBe(
        "plasmic-commerce-ep-checkout-step-indicator"
      );
      expect(epCheckoutStepIndicatorMeta.displayName).toBe(
        "EP Checkout Step Indicator (deprecated)"
      );
      expect(epCheckoutStepIndicatorMeta.description).toContain(
        "EP Checkout Session Provider"
      );
    });

    it("keeps every published prop, hiding all but the children slot", () => {
      const props = epCheckoutStepIndicatorMeta.props;
      expect(Object.keys(props).sort()).toEqual(
        ["children", "previewState"].sort()
      );
      expect(props.previewState.hidden()).toBe(true);
      expect(props.previewState.description).toMatch(/^Deprecated — ignored\./);
      expect(props.children.description).toMatch(/^Deprecated — ignored\./);
    });

    it("registerEPCheckoutStepIndicator registers with the loader", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPCheckoutStepIndicator(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPCheckoutStepIndicator,
        epCheckoutStepIndicatorMeta
      );
    });
  });
});
