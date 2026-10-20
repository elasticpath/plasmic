/** @jest-environment jsdom */

import { act, render } from "@testing-library/react";
import React from "react";

let capturedActions: any = null;
jest.mock("@plasmicapp/host", () => ({
  ...jest.requireActual("@plasmicapp/host"),
  GlobalActionsProvider: ({ actions, children }: any) => {
    capturedActions = actions;
    return <>{children}</>;
  },
}));

// jest.mock does not hoist under this project's esbuild transform.
/* eslint-disable @typescript-eslint/no-var-requires */
const { ServerCartActionsProvider } =
  require("../ServerCartActionsProvider") as typeof import("../ServerCartActionsProvider");
const { commerceProviderMeta } =
  require("../../registerCommerceProvider") as typeof import("../../registerCommerceProvider");
/* eslint-enable @typescript-eslint/no-var-requires */

const realFetch = global.fetch;
let sent: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  sent = [];
  capturedActions = null;
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [], promotions: [], itemCount: 1 }),
    } as unknown as Response;
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("the Add item to cart global action", () => {
  it("takes an optional location after quantity, keeping the saved parameters in place", () => {
    expect(
      commerceProviderMeta.globalActions.addItem.parameters.map((p: { name: string }) => p.name)
    ).toEqual(["productId", "variantId", "quantity", "location"]);
  });

  it("adds the line at the location it is given", async () => {
    render(
      <ServerCartActionsProvider globalContextName="test-provider">
        <span />
      </ServerCartActionsProvider>
    );

    await act(async () => {
      capturedActions.addItem("base-1", "child-1", 2, "warehouse-north");
    });

    expect(sent.find((r) => r.url.endsWith("/addCartItem"))?.body).toEqual({
      productId: "child-1",
      quantity: 2,
      location: "warehouse-north",
    });
  });

  it("sends no location when none is given", async () => {
    render(
      <ServerCartActionsProvider globalContextName="test-provider">
        <span />
      </ServerCartActionsProvider>
    );

    await act(async () => {
      capturedActions.addItem("prod-1", "", 1);
    });

    expect(sent.find((r) => r.url.endsWith("/addCartItem"))?.body).toEqual({
      productId: "prod-1",
      quantity: 1,
    });
  });
});
