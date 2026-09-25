/**
 * @jest-environment jsdom
 *
 * Provider + Gate + Field compose through `$ctx.account` in the canvas.
 * previewState on the Provider drives fixtures; Gate and Field only read
 * `$ctx.account`. Runtime ignore of previewState is covered on the Provider.
 */

jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  const AccountCtx = React.createContext(undefined);
  return {
    DataProvider: ({
      name,
      data,
      children,
    }: {
      name: string;
      data: unknown;
      children?: React.ReactNode;
    }) => {
      if (name !== "account") return children;
      return React.createElement(AccountCtx.Provider, { value: data }, children);
    },
    useSelector: (key: string) => {
      const data = React.useContext(AccountCtx);
      return key === "account" ? data : undefined;
    },
    usePlasmicCanvasContext: () => ({}),
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPAccountProvider } = require("../EPAccountProvider");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPAccountGate } = require("../EPAccountGate");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPAccountField } = require("../EPAccountField");

function renderTree(
  previewState: "anonymous" | "memberOnly" | "selected" | "lapsed"
) {
  return render(
    <EPAccountProvider previewState={previewState}>
      <EPAccountGate when="anonymous">
        <span>Login CTA</span>
      </EPAccountGate>
      <EPAccountGate when="authenticated">
        <span>Member </span>
        <EPAccountField field="accountMember.id" />
      </EPAccountGate>
      <EPAccountGate when="selected">
        <EPAccountField field="selectedAccount.name" />
      </EPAccountGate>
      <EPAccountGate when="lapsed">
        <span>Lapsed: </span>
        <EPAccountField field="lapsedAccount.name" />
      </EPAccountGate>
    </EPAccountProvider>
  );
}

describe("account component composition", () => {
  it("shows only the anonymous gate for the anonymous preview", () => {
    const { queryByText } = renderTree("anonymous");

    expect(queryByText("Login CTA")).toBeTruthy();
    expect(queryByText("Member")).toBeNull();
    expect(queryByText("Sample Company A")).toBeNull();
    expect(queryByText(/Lapsed:/)).toBeNull();
  });

  it("shows authenticated content without an organisation when none is selected", () => {
    const { queryByText, getByText } = renderTree("memberOnly");

    expect(queryByText("Login CTA")).toBeNull();
    expect(getByText(/Member/)).toBeTruthy();
    expect(getByText("sample-member")).toBeTruthy();
    expect(queryByText("Sample Company A")).toBeNull();
    expect(queryByText(/Lapsed:/)).toBeNull();
  });

  it("shows authenticated and selected-account content together", () => {
    const { queryByText, getByText } = renderTree("selected");

    expect(queryByText("Login CTA")).toBeNull();
    expect(getByText(/Member/)).toBeTruthy();
    expect(getByText("sample-member")).toBeTruthy();
    expect(getByText("Sample Company A")).toBeTruthy();
    expect(queryByText(/Lapsed:/)).toBeNull();
  });

  it("shows authenticated and lapsed content when the organisation has lapsed", () => {
    const { queryByText, getByText } = renderTree("lapsed");

    expect(queryByText("Login CTA")).toBeNull();
    expect(getByText(/Member/)).toBeTruthy();
    expect(getByText("sample-member")).toBeTruthy();
    expect(getByText("Lapsed:")).toBeTruthy();
    expect(getByText("Sample Company A")).toBeTruthy();
  });
});
