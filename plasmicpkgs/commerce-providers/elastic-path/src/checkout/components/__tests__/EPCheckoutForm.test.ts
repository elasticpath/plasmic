/**
 * @jest-environment jsdom
 */
jest.mock("@plasmicapp/host/registerComponent", () => jest.fn());

import React from "react";
import { act, render } from "@testing-library/react";
import { EPCheckoutForm } from "../EPCheckoutForm";
import { epCheckoutFormMeta } from "../../../registerEPCheckoutForm";

describe("Elastic Path Checkout Form (deprecated)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as any;
  });

  it("renders nothing and makes no request", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        React.createElement(EPCheckoutForm, {
          apiBaseUrl: "/api",
          className: "form",
        })
      ));
    });

    expect(container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays registered under its name, labelled deprecated, pointing to the session checkout", () => {
    expect(epCheckoutFormMeta.name).toBe("EPCheckoutForm");
    expect(epCheckoutFormMeta.displayName).toBe(
      "Elastic Path Checkout Form (deprecated)"
    );
    expect(epCheckoutFormMeta.description).toContain(
      "EP Checkout Session Provider"
    );
  });

  it("keeps every published prop, each hidden and described as ignored", () => {
    const props = epCheckoutFormMeta.props as Record<string, any>;
    expect(Object.keys(props).sort()).toEqual(
      ["apiBaseUrl", "cartId", "className", "onComplete", "onError"].sort()
    );
    for (const [name, prop] of Object.entries<any>(props)) {
      expect([name, prop.hidden()]).toEqual([name, true]);
      expect(prop.description).toMatch(/^Deprecated — ignored\./);
    }
  });

  it("keeps its event handlers off Studio's Interactions section", () => {
    // Studio ignores `hidden` on event handlers; it leaves `advanced` ones
    // out of the Interactions rows.
    const props = epCheckoutFormMeta.props as Record<string, any>;
    const handlers = Object.entries<any>(props).filter(
      ([, p]) => p.type === "eventHandler"
    );
    expect(handlers.map(([name]) => name).sort()).toEqual([
      "onComplete",
      "onError",
    ]);
    for (const [name, prop] of handlers) {
      expect([name, prop.advanced]).toEqual([name, true]);
    }
  });
});
