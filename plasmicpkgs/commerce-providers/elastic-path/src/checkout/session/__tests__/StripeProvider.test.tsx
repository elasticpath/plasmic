/**
 * @jest-environment jsdom
 *
 * StripeProvider — Plasmic global context exposing the Stripe publishable
 * key via $ctx.stripe.publishableKey.
 */

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
}));

jest.mock("@plasmicapp/host/registerGlobalContext", () => jest.fn());

import React from "react";
import { render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StripeProvider, stripeProviderMeta } = require("../StripeProvider") as {
  StripeProvider: React.FC<any>;
  stripeProviderMeta: any;
};

describe("StripeProvider", () => {
  it("exposes publishableKey via $ctx.stripe", () => {
    render(
      <StripeProvider publishableKey="pk_test_abc">
        <span>child</span>
      </StripeProvider>
    );
    const dp = screen.getByTestId("data-provider-stripe");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.publishableKey).toBe("pk_test_abc");
  });

  it("exposes null publishableKey when prop is empty", () => {
    render(
      <StripeProvider publishableKey="">
        <span>child</span>
      </StripeProvider>
    );
    const dp = screen.getByTestId("data-provider-stripe");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.publishableKey).toBeNull();
  });

  it("registers as a global context with the right name + import path", () => {
    expect(stripeProviderMeta.name).toBe(
      "plasmic-commerce-ep-stripe-provider"
    );
    expect(stripeProviderMeta.importName).toBe("StripeProvider");
    expect(stripeProviderMeta.importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path"
    );
    expect(stripeProviderMeta.providesData).toBe(true);
    expect(stripeProviderMeta.props.publishableKey).toBeDefined();
  });
});
