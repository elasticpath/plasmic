/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { CommerceProviderComponent } from "./registerCommerceProvider";

describe("CommerceProviderComponent", () => {
  it("shows error message when no clientId and serverCartMode is off", () => {
    render(
      <CommerceProviderComponent clientId="">
        <span>child</span>
      </CommerceProviderComponent>
    );
    expect(
      screen.getByText(/Please set your Elastic Path Client ID/)
    ).toBeTruthy();
    expect(screen.queryByText("child")).toBeNull();
  });

  it("renders children in serverCartMode without clientId", () => {
    render(
      <CommerceProviderComponent clientId="" serverCartMode>
        <span>server-cart-child</span>
      </CommerceProviderComponent>
    );
    expect(screen.getByText("server-cart-child")).toBeTruthy();
    expect(
      screen.queryByText(/Please set your Elastic Path Client ID/)
    ).toBeNull();
  });

  it("renders children in serverCartMode when clientId is undefined", () => {
    render(
      <CommerceProviderComponent serverCartMode>
        <span>no-creds</span>
      </CommerceProviderComponent>
    );
    expect(screen.getByText("no-creds")).toBeTruthy();
  });
});
