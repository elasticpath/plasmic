/** @jest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";
import type { CurrencyDisplay } from "../../utils/price";

jest.mock("../../client", () => ({
  __esModule: true,
  default: () => ({}),
}));

const { EpCommerceProvider } =
  require("../EpCommerceContext") as typeof import("../EpCommerceContext");
const { useMoneyFormat } =
  require("../use-money-format") as typeof import("../use-money-format");

function Probe({ onRender }: { onRender: (money: any) => void }) {
  onRender(useMoneyFormat());
  return null;
}

function renderWith(
  props: { locale?: string; currencyDisplay?: CurrencyDisplay },
  onRender: (money: any) => void
) {
  const ui = (p: typeof props) => (
    <EpCommerceProvider clientId="abc" {...p}>
      <Probe onRender={onRender} />
    </EpCommerceProvider>
  );
  const { rerender } = render(ui(props));
  return (next: typeof props) => rerender(ui(next));
}

describe("useMoneyFormat", () => {
  it("renders Elastic Path's own formatted string under the platform default", () => {
    let money: any;
    renderWith({}, (m) => (money = m));
    expect(
      money.price({
        amount: 6200,
        currency: "USD",
        float_price: 62,
        formatted: "EP-62",
      })
    ).toBe("EP-62");
  });

  it("re-formats through Intl for the configured locale and display", () => {
    let money: any;
    renderWith({ locale: "de-DE", currencyDisplay: "code" }, (m) => (money = m));
    expect(money.minor(123456, "EUR")).toBe(
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
        currencyDisplay: "code",
      }).format(1234.56)
    );
  });

  it("falls back to the platform display and default locale with no provider", () => {
    let money: any;
    render(<Probe onRender={(m) => (money = m)} />);
    expect(money.minor(6200, "USD")).toBe("$62.00");
  });

  // The identity is the contract: a memo that formats money depends on it, so
  // it must be stable while the settings are and change when they are not.
  it("keeps the same identity across re-renders with unchanged settings", () => {
    const seen: any[] = [];
    const rerender = renderWith({ currencyDisplay: "symbol" }, (m) =>
      seen.push(m)
    );
    rerender({ currencyDisplay: "symbol" });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(seen[0]);
  });

  it("changes identity when currencyDisplay changes", () => {
    const seen: any[] = [];
    const rerender = renderWith({ currencyDisplay: "symbol" }, (m) =>
      seen.push(m)
    );
    rerender({ currencyDisplay: "code" });
    expect(seen[seen.length - 1]).not.toBe(seen[0]);
  });

  it("changes identity when locale changes", () => {
    const seen: any[] = [];
    const rerender = renderWith({ locale: "en-US" }, (m) => seen.push(m));
    rerender({ locale: "de-DE" });
    expect(seen[seen.length - 1]).not.toBe(seen[0]);
  });
});
