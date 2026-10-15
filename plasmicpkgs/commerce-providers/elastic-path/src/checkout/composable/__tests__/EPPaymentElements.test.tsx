/**
 * @jest-environment jsdom
 */
const mockLoadStripeJs = jest.fn();
jest.mock("../../stripe/load-stripe-js", () => ({
  loadStripeJs: () => mockLoadStripeJs(),
}));

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name }: any) => (
    <div data-testid={`data-provider-${name}`}>{children}</div>
  ),
  usePlasmicCanvasContext: (...args: any[]) =>
    mockUsePlasmicCanvasContext(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { act, render } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPPaymentElements,
  registerEPPaymentElements,
  epPaymentElementsMeta,
} = require("../EPPaymentElements");

describe("EPPaymentElements (deprecated)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
    global.fetch = fetchMock as any;
  });

  it.each([
    ["on a page", false],
    ["on the Studio canvas", true],
  ])("renders its children and nothing else %s", async (_where, inEditor) => {
    mockUsePlasmicCanvasContext.mockReturnValue(inEditor);
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <EPPaymentElements
          stripePublishableKey="pk_test_123"
          className="pay"
          previewState="error"
        >
          <span>Pay</span>
        </EPPaymentElements>
      ));
    });

    expect(container.innerHTML).toBe("<span>Pay</span>");
  });

  it("loads no Stripe.js and makes no request", async () => {
    await act(async () => {
      render(
        <EPPaymentElements stripePublishableKey="pk_test_123">
          <span>Pay</span>
        </EPPaymentElements>
      );
    });

    expect(mockLoadStripeJs).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("registration", () => {
    it("stays registered under its name, labelled deprecated, pointing to EP Stripe Payment", () => {
      expect(epPaymentElementsMeta.name).toBe(
        "plasmic-commerce-ep-payment-elements"
      );
      expect(epPaymentElementsMeta.displayName).toBe(
        "EP Payment Elements (deprecated)"
      );
      expect(epPaymentElementsMeta.description).toContain("EP Stripe Payment");
      expect(epPaymentElementsMeta.description).not.toMatch(/Renders Stripe/);
    });

    it("keeps every published prop, hiding all but the children slot", () => {
      const props = epPaymentElementsMeta.props;
      expect(Object.keys(props).sort()).toEqual(
        ["appearance", "children", "previewState", "stripePublishableKey"].sort()
      );
      for (const [name, prop] of Object.entries<any>(props)) {
        if (name === "children") continue;
        expect([name, prop.hidden()]).toEqual([name, true]);
        expect(prop.description).toMatch(/^Deprecated — ignored\./);
      }
    });

    it("registerEPPaymentElements registers with the loader", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPPaymentElements(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPPaymentElements,
        epPaymentElementsMeta
      );
    });
  });
});
