/** @jest-environment jsdom */

const mockUseSelector = jest.fn().mockReturnValue(undefined);
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);

jest.mock("@plasmicapp/host", () => ({
  useSelector: (key: string) => mockUseSelector(key),
  usePlasmicCanvasContext: () => mockUsePlasmicCanvasContext(),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render } from "@testing-library/react";
import type { EpAccountAddress } from "../../identity/operations";
import { MOCK_ACCOUNT_ADDRESSES } from "../../utils/design-time-data";
import type { AccountAddressFieldName } from "../types";

const {
  EPAccountAddressField,
  registerEPAccountAddressField,
  epAccountAddressFieldMeta,
} = require("../EPAccountAddressField");

const address: EpAccountAddress = {
  id: "addr-1",
  name: "Office",
  first_name: "Ada",
  last_name: "Lovelace",
  company_name: "Sample Co",
  phone_number: "020 7946 0000",
  instructions: "Reception",
  line_1: "1 Sample Street",
  city: "London",
  region: "England",
  postcode: "SW1A 1AA",
  country: "GB",
};

describe("EPAccountAddressField", () => {
  beforeEach(() => {
    mockUseSelector.mockReset();
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("reads currentAccountAddress", () => {
    mockUseSelector.mockReturnValue(address);
    render(<EPAccountAddressField field="name" />);
    expect(mockUseSelector).toHaveBeenCalledWith("currentAccountAddress");
  });

  it.each([
    ["name", "Office"],
    ["first_name", "Ada"],
    ["last_name", "Lovelace"],
    ["company_name", "Sample Co"],
    ["phone_number", "020 7946 0000"],
    ["instructions", "Reception"],
    ["line_1", "1 Sample Street"],
    ["line_2", ""],
    ["city", "London"],
    ["county", ""],
    ["region", "England"],
    ["postcode", "SW1A 1AA"],
    ["country", "GB"],
  ] as const)("renders %s", (field: AccountAddressFieldName, expected) => {
    mockUseSelector.mockReturnValue(address);
    const { container } = render(<EPAccountAddressField field={field} />);
    const node = container.querySelector("[data-ep-account-address-field]");
    expect(node).not.toBeNull();
    expect(node?.textContent).toBe(expected);
  });

  it("defaults to the address name", () => {
    mockUseSelector.mockReturnValue(address);
    const { container } = render(<EPAccountAddressField />);
    expect(container.textContent).toBe("Office");
  });

  it("renders nothing at runtime when there is no current address", () => {
    const { container } = render(<EPAccountAddressField field="name" />);
    expect(container.firstChild).toBeNull();
  });

  it("uses the first fixture address on the canvas when none is current", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { container } = render(<EPAccountAddressField field="line_1" />);
    expect(container.textContent).toBe(MOCK_ACCOUNT_ADDRESSES[0].line_1);
  });

  describe("registration", () => {
    it("uses contract field names and omits id", () => {
      expect(epAccountAddressFieldMeta.name).toBe(
        "plasmic-commerce-ep-account-address-field"
      );
      expect(epAccountAddressFieldMeta.displayName).toBe(
        "EP Account Address Field"
      );
      expect(epAccountAddressFieldMeta.importName).toBe(
        "EPAccountAddressField"
      );
      expect(epAccountAddressFieldMeta.importPath).toBe(
        "@elasticpath/plasmic-ep-commerce-elastic-path"
      );
      expect(epAccountAddressFieldMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-address-provider"
      );
      expect(epAccountAddressFieldMeta.providesData).toBeUndefined();
      expect(epAccountAddressFieldMeta.refActions).toBeUndefined();
      expect(Object.keys(epAccountAddressFieldMeta.props ?? {})).toEqual([
        "field",
      ]);
      const field = (epAccountAddressFieldMeta.props as any).field;
      expect(field.defaultValue).toBe("name");
      expect(field.options).toEqual([
        { label: "Name", value: "name" },
        { label: "First name", value: "first_name" },
        { label: "Last name", value: "last_name" },
        { label: "Company name", value: "company_name" },
        { label: "Phone number", value: "phone_number" },
        { label: "Instructions", value: "instructions" },
        { label: "Line 1", value: "line_1" },
        { label: "Line 2", value: "line_2" },
        { label: "City", value: "city" },
        { label: "County", value: "county" },
        { label: "Region", value: "region" },
        { label: "Postcode", value: "postcode" },
        { label: "Country", value: "country" },
      ]);
      expect(
        field.options.map((option: { value: string }) => option.value)
      ).not.toContain("id");
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountAddressField(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountAddressField,
        epAccountAddressFieldMeta
      );
    });
  });
});
