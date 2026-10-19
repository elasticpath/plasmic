/**
 * @jest-environment jsdom
 *
 * Preview State is a Studio canvas setting. On a published page every cart
 * and checkout component renders and publishes what it does with "auto",
 * whatever Preview State was saved: shoppers never see sample data.
 */
import { render } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";

let mockInCanvas = false;
jest.mock("@plasmicapp/host", () => ({
  ...jest.requireActual("@plasmicapp/host"),
  usePlasmicCanvasContext: () => (mockInCanvas ? {} : undefined),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { useDataEnv } = require("@plasmicapp/host") as typeof import("@plasmicapp/host");
const C = {
  ...require("../checkout/composable/EPBillingAddressFields"),
  ...require("../checkout/composable/EPBillingAddressToggle"),
  ...require("../checkout/composable/EPCheckoutCartField"),
  ...require("../checkout/composable/EPCheckoutCartItemList"),
  ...require("../checkout/composable/EPCheckoutCartSummary"),
  ...require("../checkout/composable/EPCustomerInfoFields"),
  ...require("../checkout/composable/EPOrderTotalsBreakdown"),
  ...require("../checkout/composable/EPPromoCodeInput"),
  ...require("../checkout/composable/EPShippingAddressFields"),
  ...require("../checkout/composable/EPShippingMethodSelector"),
  ...require("../checkout/session/EPCheckoutShippingRates"),
  ...require("../cart-drawer/EPCartDrawer"),
  ...require("../cart-drawer/EPCartDrawerTrigger"),
  ...require("../cart-drawer/EPCartField"),
  ...require("../cart-drawer/EPCartItemField"),
  ...require("../cart-drawer/EPCartItemImage"),
  ...require("../cart-drawer/EPCartItemList"),
  ...require("../cart-drawer/EPCartItemQuantityButton"),
  ...require("../cart-drawer/EPCartItemQuantityControl"),
  ...require("../cart-drawer/EPCartItemQuantitySelect"),
  ...require("../cart-drawer/EPCartItemRemoveButton"),
  ...require("../cart-drawer/EPCartPopover"),
  ...require("../cart-provider/EPCartProvider"),
  ...require("../registerEPAddToCartButton"),
};
/* eslint-enable @typescript-eslint/no-var-requires */

const CASES: Array<[string, string, Record<string, unknown>?]> = [
  ["EPBillingAddressFields", "epBillingAddressFieldsMeta"],
  ["EPBillingAddressToggle", "epBillingAddressToggleMeta"],
  ["EPCheckoutCartField", "epCheckoutCartFieldMeta", { field: "itemCount" }],
  ["EPCheckoutCartItemList", "epCheckoutCartItemListMeta"],
  ["EPCheckoutCartSummary", "epCheckoutCartSummaryMeta"],
  ["EPCustomerInfoFields", "epCustomerInfoFieldsMeta"],
  ["EPOrderTotalsBreakdown", "epOrderTotalsBreakdownMeta"],
  ["EPPromoCodeInput", "epPromoCodeInputMeta"],
  ["EPShippingAddressFields", "epShippingAddressFieldsMeta"],
  ["EPShippingMethodSelector", "epShippingMethodSelectorMeta"],
  ["EPCheckoutShippingRates", "epCheckoutShippingRatesMeta"],
  ["EPCartDrawer", "epCartDrawerMeta"],
  ["EPCartDrawer", "epCartInlineMeta", { inline: true }],
  ["EPCartDrawerTrigger", "epCartDrawerTriggerMeta"],
  ["EPCartField", "epCartFieldMeta", { field: "itemCount" }],
  ["EPCartItemField", "epCartItemFieldMeta", { field: "name" }],
  ["EPCartItemImage", "epCartItemImageMeta"],
  ["EPCartItemList", "epCartItemListMeta"],
  ["EPCartItemQuantityButton", "epCartItemQuantityButtonMeta", { action: "increment" }],
  ["EPCartItemQuantityControl", "epCartItemQuantityControlMeta"],
  ["EPCartItemQuantitySelect", "epCartItemQuantitySelectMeta"],
  ["EPCartItemRemoveButton", "epCartItemRemoveButtonMeta"],
  ["EPCartPopover", "epCartPopoverMeta"],
  ["EPCartProvider", "epCartProviderMeta"],
  ["EPAddToCartButton", "epAddToCartButtonMeta"],
];

/** Everything a designer can bind from `$ctx`, shown as text. */
function Published() {
  const env = useDataEnv() ?? {};
  return <pre data-testid="published">{JSON.stringify(env)}</pre>;
}

function renderLive(name: string, props: Record<string, unknown>, withProbe: boolean) {
  const Component = C[name];
  const { unmount } = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Component {...props}>{withProbe ? <Published /> : undefined}</Component>
    </SWRConfig>
  );
  const html = document.body.innerHTML;
  unmount();
  document.body.innerHTML = "";
  return html;
}

beforeEach(() => {
  mockInCanvas = false;
  global.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as any;
});

const rows = CASES.flatMap(([name, metaName, extra]) => {
  const options: string[] = C[metaName].props.previewState.options;
  return options
    .filter((o) => o !== "auto")
    .map((option) => [`${metaName} ${option}`, name, option, extra ?? {}] as const);
});

it("covers every Preview State of the audited components", () => {
  expect(rows.length).toBeGreaterThan(40);
});

/** Every sample value a component could show: money, names, emails, streets. */
function sampleMarkers(): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v == null) return;
    if (typeof v === "string") {
      if (/^\$\d+\.\d\d$/.test(v) ? v !== "$0.00" : /[A-Za-z]{3,}.*\s|@/.test(v) && v.length >= 8) {
        found.add(v);
      }
      return;
    }
    if (typeof v === "object") Object.values(v as object).forEach((x) => walk(x, depth + 1));
  };
  /* eslint-disable @typescript-eslint/no-var-requires */
  const modules = [
    require("../utils/design-time-data"),
    require("../checkout/session/design-time-data"),
  ];
  /* eslint-enable @typescript-eslint/no-var-requires */
  modules.forEach((m) =>
    Object.entries(m).forEach(([k, v]) => k.startsWith("MOCK_") && walk(v, 0))
  );
  return [...found];
}

describe("with no cart and no checkout session on a published page", () => {
  const markers = sampleMarkers();

  it("knows the sample values", () => {
    expect(markers).toEqual(expect.arrayContaining(["$72.91", "$62.00"]));
  });

  const components = [...new Map(CASES.map(([n, , e]) => [n, e ?? {}])).entries()];
  it.each(components)("%s shows and publishes no sample value", (name, extra) => {
    const shown = renderLive(name, extra, false) + renderLive(name, extra, true);
    expect(markers.filter((m) => shown.includes(m))).toEqual([]);
  });
});

describe.each([
  ["default content", false],
  ["published data", true],
])("on a published page (%s)", (_label, withProbe) => {
  it.each(rows)("%s renders as auto", (_label2, name, option, extra) => {
    const auto = renderLive(name, { ...extra, previewState: "auto" }, withProbe);
    const forced = renderLive(name, { ...extra, previewState: option }, withProbe);
    expect(forced).toBe(auto);
  });
});
