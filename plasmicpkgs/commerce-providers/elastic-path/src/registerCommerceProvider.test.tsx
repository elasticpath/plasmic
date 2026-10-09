/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import {
  CommerceProviderComponent,
  commerceProviderMeta,
} from "./registerCommerceProvider";
import { useEpCommerce } from "./shopper-context/EpCommerceContext";

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

  it("keeps child state when a provider prop changes", () => {
    let mounts = 0;
    function Child() {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <span>child</span>;
    }

    const { rerender } = render(
      <CommerceProviderComponent clientId="abc" locale="en-US">
        <Child />
      </CommerceProviderComponent>
    );
    expect(mounts).toBe(1);

    rerender(
      <CommerceProviderComponent clientId="abc" locale="en-GB">
        <Child />
      </CommerceProviderComponent>
    );
    expect(mounts).toBe(1);
  });

  it("does not pass the retired currency prop to useEpCommerce", () => {
    let seen: ReturnType<typeof useEpCommerce> = null;
    function Reader() {
      seen = useEpCommerce();
      return null;
    }

    render(
      <CommerceProviderComponent clientId="abc" locale="en-GB" currency="GBP">
        <Reader />
      </CommerceProviderComponent>
    );

    expect(seen).toMatchObject({ locale: "en-GB" });
    expect(seen!.currency).toBeUndefined();
  });

  it("survives a clientId being filled in", () => {
    const { rerender } = render(
      <CommerceProviderComponent clientId="">
        <span>child</span>
      </CommerceProviderComponent>
    );

    expect(() =>
      rerender(
        <CommerceProviderComponent clientId="abc">
          <span>child</span>
        </CommerceProviderComponent>
      )
    ).not.toThrow();
  });
});

describe("commerceProviderMeta", () => {
  it.each(["serverToken", "serverCartMode", "currency"])(
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
