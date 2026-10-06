/** @jest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";
import { EpCommerceProvider, useEpCommerce } from "../EpCommerceContext";

function Probe({ onValue }: { onValue: (v: unknown) => void }) {
  onValue(useEpCommerce());
  return null;
}

describe("useEpCommerce", () => {
  it("returns null with no provider above it", () => {
    let value: unknown = "unset";
    render(<Probe onValue={(v) => (value = v)} />);
    expect(value).toBeNull();
  });

  it("exposes locale, currency and currencyDisplay, and no client", () => {
    let value: any;
    render(
      <EpCommerceProvider
        clientId="abc"
        locale="fr-FR"
        currency="EUR"
        currencyDisplay="code"
      >
        <Probe onValue={(v) => (value = v)} />
      </EpCommerceProvider>
    );
    expect(value).toEqual({
      locale: "fr-FR",
      currency: "EUR",
      currencyDisplay: "code",
    });
  });
});

describe("EpCommerceProvider", () => {
  it("keeps the context value identical across a re-render with unchanged props", () => {
    const seen: unknown[] = [];
    const { rerender } = render(
      <EpCommerceProvider clientId="abc" locale="en-US">
        <Probe onValue={(v) => seen.push(v)} />
      </EpCommerceProvider>
    );
    rerender(
      <EpCommerceProvider clientId="abc" locale="en-US">
        <Probe onValue={(v) => seen.push(v)} />
      </EpCommerceProvider>
    );

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it("publishes nothing a caller could authenticate with", () => {
    let value: any;
    render(
      <EpCommerceProvider clientId="abc" host="https://useast.api.elasticpath.com">
        <Probe onValue={(v) => (value = v)} />
      </EpCommerceProvider>
    );
    expect(Object.keys(value).sort()).toEqual([
      "currency",
      "currencyDisplay",
      "locale",
    ]);
  });
});
