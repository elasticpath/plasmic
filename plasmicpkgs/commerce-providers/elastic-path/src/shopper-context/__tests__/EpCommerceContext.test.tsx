/** @jest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";

const mockInit = jest.fn();
jest.mock("../../client", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockInit(...args),
}));

const { EpCommerceProvider, useEpCommerce } =
  require("../EpCommerceContext") as typeof import("../EpCommerceContext");

function Probe({ onValue }: { onValue: (v: unknown) => void }) {
  onValue(useEpCommerce());
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInit.mockImplementation((creds: { clientId: string; host?: string }) => ({
    tag: `${creds.clientId}:${creds.host ?? ""}`,
  }));
});

describe("useEpCommerce", () => {
  it("returns null with no provider above it", () => {
    let value: unknown = "unset";
    render(<Probe onValue={(v) => (value = v)} />);
    expect(value).toBeNull();
  });

  it("exposes the client, locale, currency and currencyDisplay", () => {
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
      client: { tag: "abc:" },
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

  it("does not rebuild the client when an unrelated prop changes", () => {
    const { rerender } = render(
      <EpCommerceProvider clientId="abc" currency="USD">
        <Probe onValue={() => undefined} />
      </EpCommerceProvider>
    );
    expect(mockInit).toHaveBeenCalledTimes(1);

    rerender(
      <EpCommerceProvider clientId="abc" currency="GBP">
        <Probe onValue={() => undefined} />
      </EpCommerceProvider>
    );
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the client when clientId or host changes", () => {
    const { rerender } = render(
      <EpCommerceProvider clientId="abc">
        <Probe onValue={() => undefined} />
      </EpCommerceProvider>
    );
    expect(mockInit).toHaveBeenCalledTimes(1);

    rerender(
      <EpCommerceProvider clientId="def">
        <Probe onValue={() => undefined} />
      </EpCommerceProvider>
    );
    expect(mockInit).toHaveBeenCalledTimes(2);

    rerender(
      <EpCommerceProvider clientId="def" host="https://useast.api.elasticpath.com">
        <Probe onValue={() => undefined} />
      </EpCommerceProvider>
    );
    expect(mockInit).toHaveBeenCalledTimes(3);
  });
});
