/** @jest-environment jsdom */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
const mockRepeatedElement = jest.fn(
  (_index: number, children: React.ReactNode) => children
);

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
    repeatedElement: (index: number, children: React.ReactNode) =>
      mockRepeatedElement(index, children),
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen } from "@testing-library/react";
import type { EpAccountAddress } from "../../identity/operations";
import { MOCK_ACCOUNT_ADDRESSES } from "../../utils/design-time-data";
import type { AccountAddressBookContext } from "../types";

const {
  EPAccountAddressList,
  registerEPAccountAddressList,
  epAccountAddressListMeta,
} = require("../EPAccountAddressList");

const addressA: EpAccountAddress = {
  id: "addr-a",
  name: "Office A",
  line_1: "Line A",
};
const addressB: EpAccountAddress = {
  id: "addr-b",
  name: "Office B",
  line_1: "Line B",
};

function ready(addresses: EpAccountAddress[]): AccountAddressBookContext {
  return { status: "ready", addresses, total: addresses.length, error: null };
}

function Book(props: {
  book?: AccountAddressBookContext;
  children?: React.ReactNode;
}) {
  const { DataProvider } = require("@plasmicapp/host");
  return (
    <DataProvider name="accountAddresses" data={props.book}>
      <EPAccountAddressList>{props.children}</EPAccountAddressList>
    </DataProvider>
  );
}

function RowLabel() {
  const { useSelector } = require("@plasmicapp/host");
  const address = useSelector("currentAccountAddress") as EpAccountAddress;
  const index = useSelector("currentAccountAddressIndex") as number;
  return (
    <span>
      {index}:{address.line_1}
    </span>
  );
}

describe("EPAccountAddressList", () => {
  beforeEach(() => {
    mockRepeatedElement.mockClear();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("repeats children for a ready collection and isolates each row", () => {
    render(
      <Book book={ready([addressA, addressB])}>
        <RowLabel />
      </Book>
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "0:Line A",
      "1:Line B",
    ]);
    expect(screen.getByRole("list").getAttribute("aria-label")).toBe(
      "Saved addresses"
    );
    expect(mockRepeatedElement.mock.calls.map((call) => call[0])).toEqual([
      0, 1,
    ]);
  });

  it.each(["loading", "empty", "error"] as const)(
    "renders no rows when status is %s",
    (status) => {
      const book: AccountAddressBookContext = {
        status,
        addresses: status === "empty" ? [] : [addressA],
        total: 0,
        error:
          status === "error"
            ? { code: "account_addresses_read_failed", message: "nope" }
            : null,
      };
      render(
        <Book book={book}>
          <span>Row</span>
        </Book>
      );
      expect(screen.queryByText("Row")).toBeNull();
      expect(screen.queryByRole("list")).toBeNull();
      expect(mockRepeatedElement).not.toHaveBeenCalled();
    }
  );

  it("uses fixture addresses on the canvas when no book is published", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(
      <Book>
        <RowLabel />
      </Book>
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      MOCK_ACCOUNT_ADDRESSES.map((address, index) => `${index}:${address.line_1}`)
    );
  });

  it("does not substitute fixtures over a published empty book on the canvas", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    render(
      <Book book={{ status: "empty", addresses: [], total: 0, error: null }}>
        <span>Row</span>
      </Book>
    );
    expect(screen.queryByText("Row")).toBeNull();
  });

  describe("registration", () => {
    it("points at the address provider and publishes row data", () => {
      expect(epAccountAddressListMeta.name).toBe(
        "plasmic-commerce-ep-account-address-list"
      );
      expect(epAccountAddressListMeta.displayName).toBe(
        "EP Account Address List"
      );
      expect(epAccountAddressListMeta.importName).toBe("EPAccountAddressList");
      expect(epAccountAddressListMeta.importPath).toBe(
        "@elasticpath/plasmic-ep-commerce-elastic-path"
      );
      expect(epAccountAddressListMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-address-provider"
      );
      expect(epAccountAddressListMeta.providesData).toBe(true);
      expect(epAccountAddressListMeta.refActions).toBeUndefined();
      expect(Object.keys(epAccountAddressListMeta.props ?? {})).toEqual([
        "children",
      ]);
      const fields = (
        epAccountAddressListMeta.props as any
      ).children.defaultValue[0].children.map(
        (child: { props: { field: string } }) => child.props.field
      );
      expect(fields).toEqual(["name", "line_1", "city", "postcode", "country"]);
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountAddressList(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountAddressList,
        epAccountAddressListMeta
      );
    });
  });
});
