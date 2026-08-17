/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import {
  CommerceProviderComponent,
  commerceProviderMeta,
} from "./registerCommerceProvider";

describe("CommerceProviderComponent", () => {
  it("renders children without a clientId", () => {
    render(
      <CommerceProviderComponent clientId="">
        <span>server-cart-child</span>
      </CommerceProviderComponent>
    );
    expect(screen.getByText("server-cart-child")).toBeTruthy();
  });

  it("renders children when clientId is undefined", () => {
    render(
      <CommerceProviderComponent {...({} as { clientId: string })}>
        <span>no-creds</span>
      </CommerceProviderComponent>
    );
    expect(screen.getByText("no-creds")).toBeTruthy();
  });
});

describe("commerceProviderMeta", () => {
  it.each(["serverToken", "serverCartMode"])(
    "keeps the retired %s prop registered and hidden",
    (propName) => {
      const prop = commerceProviderMeta.props[propName];
      expect(prop).toBeDefined();
      expect(prop.hidden()).toBe(true);
    }
  );

  it("declares no getServerInfo bridge", () => {
    expect(commerceProviderMeta.getServerInfo).toBeUndefined();
  });
});
