/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { ShopperContext } from "../ShopperContext";
import { shopperContextMeta } from "../registerShopperContext";

describe("ShopperContext", () => {
  it("renders children", () => {
    render(
      <ShopperContext>
        <span>hello</span>
      </ShopperContext>
    );
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("renders nothing of its own around them", () => {
    const { container } = render(
      <ShopperContext cartId="cart-123" accountId="acct-456">
        <span>hello</span>
      </ShopperContext>
    );
    expect(container.innerHTML).toBe("<span>hello</span>");
  });
});

describe("shopperContextMeta", () => {
  it("says it is deprecated where a designer sees it", () => {
    expect(shopperContextMeta.displayName).toMatch(/\(deprecated\)$/);
  });

  it.each(["cartId", "accountId", "locale", "currency"])(
    "keeps %s registered, hidden, and described as ignored",
    (propName) => {
      const prop = (shopperContextMeta.props as any)[propName];
      expect(prop).toBeDefined();
      expect(prop.hidden()).toBe(true);
      expect(prop.description).toMatch(/^Deprecated — ignored\./);
    }
  );
});
