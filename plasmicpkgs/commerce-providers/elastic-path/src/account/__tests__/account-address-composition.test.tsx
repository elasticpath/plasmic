/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockAccountAddresses = jest.fn();
const mockIdentity = { accountAddresses: mockAccountAddresses };

jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  const DataCtx = React.createContext({});
  return {
    DataProvider: ({ name, data, children }: any) => {
      const parent = React.useContext(DataCtx);
      const next = { ...parent, [name]: data };
      return React.createElement(
        DataCtx.Provider,
        { value: next },
        children
      );
    },
    useSelector: (key: string) => React.useContext(DataCtx)[key],
    usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
    repeatedElement: (_i: number, children: React.ReactNode) => children,
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

jest.mock("../../identity/useEpIdentity", () => ({
  useEpIdentity: () => mockIdentity,
}));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import type { EpAccountAddress } from "../../identity/operations";
import { MOCK_ACCOUNT_SELECTED } from "../../utils/design-time-data";
import type { AccountContext } from "../types";

const { EPAccountAddressProvider } = require("../EPAccountAddressProvider");
const { EPAccountAddressList } = require("../EPAccountAddressList");
const { EPAccountAddressField } = require("../EPAccountAddressField");
const { DataProvider } = require("@plasmicapp/host");

const full: EpAccountAddress = {
  id: "addr-full",
  name: "Office",
  first_name: "Ada",
  last_name: "Lovelace",
  company_name: "Sample Co",
  phone_number: "020 7946 0000",
  instructions: "Reception",
  line_1: "1 Sample Street",
  line_2: "Floor 2",
  city: "London",
  county: "Greater London",
  region: "England",
  postcode: "SW1A 1AA",
  country: "GB",
};

const sparse: EpAccountAddress = {
  id: "addr-sparse",
  name: "Warehouse",
  line_1: "9 Fixture Road",
  city: "Manchester",
  postcode: "M1 1AE",
  country: "GB",
};

const account: AccountContext = {
  ...MOCK_ACCOUNT_SELECTED,
  state: "selected",
  isLoading: false,
  selectedAccount: { id: "acct-a", name: "Acme" },
  lapsedAccount: null,
};

function Tree(props: { children?: React.ReactNode }) {
  return (
    <DataProvider name="account" data={account}>
      <EPAccountAddressProvider>
        <span data-testid="sibling">Stay</span>
        <EPAccountAddressList>{props.children}</EPAccountAddressList>
      </EPAccountAddressProvider>
    </DataProvider>
  );
}

describe("account address composition", () => {
  beforeEach(() => {
    mockAccountAddresses.mockReset();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("renders each address through List and Field, including a missing optional field", async () => {
    mockAccountAddresses.mockResolvedValue({
      addresses: [full, sparse],
      total: 2,
    });
    render(
      <Tree>
        <EPAccountAddressField field="line_1" />
        <EPAccountAddressField field="line_2" />
      </Tree>
    );

    await waitFor(() => expect(screen.getByText("1 Sample Street")).toBeTruthy());
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("1 Sample Street");
    expect(items[0].textContent).toContain("Floor 2");
    expect(items[1].textContent).toContain("9 Fixture Road");
    const secondLine2 = items[1].querySelectorAll(
      "[data-ep-account-address-field]"
    )[1];
    expect(secondLine2).not.toBeNull();
    expect(secondLine2?.textContent).toBe("");
    expect(items[0].textContent).not.toContain("9 Fixture Road");
    expect(items[1].textContent).not.toContain("1 Sample Street");
    expect(screen.getByTestId("sibling")).toBeTruthy();
    expect(mockAccountAddresses.mock.calls[0]).toEqual([]);
  });

  it("keeps a sibling mounted when the collection is empty", async () => {
    mockAccountAddresses.mockResolvedValue({ addresses: [], total: 0 });
    render(
      <Tree>
        <EPAccountAddressField field="line_1" />
      </Tree>
    );
    await waitFor(() =>
      expect(screen.queryByRole("list")).toBeNull()
    );
    expect(screen.getByTestId("sibling")).toBeTruthy();
  });
});
