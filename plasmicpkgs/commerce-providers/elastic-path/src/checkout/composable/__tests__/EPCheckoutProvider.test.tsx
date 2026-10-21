/**
 * @jest-environment jsdom
 */
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name }: any) => (
    <div data-testid={`data-provider-${name}`}>{children}</div>
  ),
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
import { act, render } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPCheckoutProvider,
  registerEPCheckoutProvider,
  epCheckoutProviderMeta,
} = require("../EPCheckoutProvider");

const REF_ACTIONS = [
  "nextStep",
  "previousStep",
  "goToStep",
  "submitCustomerInfo",
  "submitShippingAddress",
  "submitBillingAddress",
  "selectShippingRate",
  "submitPayment",
  "reset",
];

describe("EPCheckoutProvider (deprecated)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
    global.fetch = fetchMock as any;
  });

  it("renders its children and nothing else", () => {
    const { container } = render(
      <EPCheckoutProvider
        cartId="cart-from-the-page"
        className="checkout"
        loadingContent={<span>loading</span>}
        errorContent={<span>error</span>}
      >
        <span data-testid="child">Hello</span>
      </EPCheckoutProvider>
    );

    expect(container.innerHTML).toBe('<span data-testid="child">Hello</span>');
  });

  it("renders only its children in the Studio canvas, whatever the preview state", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { container } = render(
      <EPCheckoutProvider previewState="payment">
        <span>Hello</span>
      </EPCheckoutProvider>
    );

    expect(container.innerHTML).toBe("<span>Hello</span>");
  });

  it("makes no request, so the browser never needs the cart id", async () => {
    await act(async () => {
      render(
        <EPCheckoutProvider>
          <span>Hello</span>
        </EPCheckoutProvider>
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps every ref action callable, doing nothing", async () => {
    const ref = React.createRef<any>();
    render(
      <EPCheckoutProvider ref={ref}>
        <span>Hello</span>
      </EPCheckoutProvider>
    );

    for (const name of REF_ACTIONS) {
      await act(async () => {
        await ref.current[name]({});
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("registration", () => {
    it("stays registered under its name, labelled deprecated", () => {
      expect(epCheckoutProviderMeta.name).toBe(
        "plasmic-commerce-ep-checkout-provider"
      );
      expect(epCheckoutProviderMeta.displayName).toBe(
        "EP Checkout Provider (deprecated)"
      );
      expect(epCheckoutProviderMeta.description).toContain(
        "EP Checkout Session Provider"
      );
    });

    it("hides the Cart ID prop and says it is ignored", () => {
      const { cartId } = epCheckoutProviderMeta.props;
      expect(cartId.hidden()).toBe(true);
      expect(cartId.description).toMatch(/^Deprecated — ignored\./);
    });

    it("keeps every published prop, hiding all but the children slot", () => {
      const props = epCheckoutProviderMeta.props;
      expect(Object.keys(props).sort()).toEqual(
        [
          "apiBaseUrl",
          "autoAdvanceSteps",
          "cartId",
          "children",
          "errorContent",
          "loadingContent",
          "previewState",
        ].sort()
      );
      for (const [name, prop] of Object.entries<any>(props)) {
        if (name === "children") continue;
        expect([name, prop.hidden()]).toEqual([name, true]);
        expect(prop.description).toMatch(/^Deprecated — ignored\./);
      }
    });

    it("keeps every ref action, each described as deprecated", () => {
      expect(Object.keys(epCheckoutProviderMeta.refActions).sort()).toEqual(
        [...REF_ACTIONS].sort()
      );
      for (const action of Object.values<any>(
        epCheckoutProviderMeta.refActions
      )) {
        expect(action.description).toMatch(/^Deprecated — /);
      }
    });

    it("registerEPCheckoutProvider registers with the loader", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPCheckoutProvider(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPCheckoutProvider,
        epCheckoutProviderMeta
      );
    });
  });
});
