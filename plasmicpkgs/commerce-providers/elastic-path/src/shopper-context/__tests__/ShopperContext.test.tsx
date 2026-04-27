/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { ShopperContext, getShopperContext } from "../ShopperContext";
import type { ShopperOverrides } from "../ShopperContext";
import { useShopperContext } from "../useShopperContext";

// Helper component that displays context values
function ContextReader() {
  const ctx = useShopperContext();
  return <pre data-testid="ctx">{JSON.stringify(ctx)}</pre>;
}

describe("ShopperContext", () => {
  it("renders children", () => {
    render(
      <ShopperContext>
        <span>hello</span>
      </ShopperContext>
    );
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("provides overrides when props are set", () => {
    render(
      <ShopperContext cartId="cart-123" accountId="acct-456">
        <ContextReader />
      </ShopperContext>
    );
    const ctx: ShopperOverrides = JSON.parse(
      screen.getByTestId("ctx").textContent!
    );
    expect(ctx.cartId).toBe("cart-123");
    expect(ctx.accountId).toBe("acct-456");
  });

  it("returns empty overrides when no props are set", () => {
    render(
      <ShopperContext>
        <ContextReader />
      </ShopperContext>
    );
    const ctx: ShopperOverrides = JSON.parse(
      screen.getByTestId("ctx").textContent!
    );
    // All values should be undefined (omitted from JSON)
    expect(ctx.cartId).toBeUndefined();
    expect(ctx.accountId).toBeUndefined();
    expect(ctx.locale).toBeUndefined();
    expect(ctx.currency).toBeUndefined();
  });

  it("coerces empty strings to undefined", () => {
    render(
      <ShopperContext cartId="" locale="">
        <ContextReader />
      </ShopperContext>
    );
    const ctx: ShopperOverrides = JSON.parse(
      screen.getByTestId("ctx").textContent!
    );
    expect(ctx.cartId).toBeUndefined();
    expect(ctx.locale).toBeUndefined();
  });

  it("returns empty overrides when no provider is above", () => {
    render(<ContextReader />);
    const ctx: ShopperOverrides = JSON.parse(
      screen.getByTestId("ctx").textContent!
    );
    // Default context value is {} so all fields are undefined
    expect(ctx.cartId).toBeUndefined();
    expect(Object.keys(ctx).length).toBe(0);
  });

  it("getShopperContext returns the same context instance (singleton)", () => {
    const ctx1 = getShopperContext();
    const ctx2 = getShopperContext();
    expect(ctx1).toBe(ctx2);
  });
});
