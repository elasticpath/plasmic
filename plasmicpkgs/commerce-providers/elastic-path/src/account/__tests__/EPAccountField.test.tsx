/**
 * @jest-environment jsdom
 *
 * EPAccountField — choice values are the binding contract against
 * `$ctx.account`. Missing slots render as an empty string, not a fallback
 * fixture of the Field's own.
 */

const mockUseSelector = jest.fn().mockReturnValue(undefined);
const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);

jest.mock("@plasmicapp/host", () => ({
  useSelector: (...args: any[]) => mockUseSelector(...args),
  usePlasmicCanvasContext: (...args: any[]) =>
    mockUsePlasmicCanvasContext(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render } from "@testing-library/react";
import {
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_LAPSED,
  MOCK_ACCOUNT_SELECTED,
} from "../../utils/design-time-data";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPAccountField,
  registerEPAccountField,
  epAccountFieldMeta,
} = require("../EPAccountField");

describe("EPAccountField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockReturnValue(undefined);
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("reads the account DataProvider key", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
    render(<EPAccountField field="selectedAccount.name" />);
    expect(mockUseSelector).toHaveBeenCalledWith("account");
  });

  it("renders nothing outside an account provider at runtime", () => {
    const { container } = render(
      <EPAccountField field="selectedAccount.name" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("uses the selected mock floor in Studio when no account is published", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { container } = render(
      <EPAccountField field="selectedAccount.name" />
    );
    expect(container.textContent).toBe("Sample Company A");
  });

  it.each([
    ["accountMember.id", "sample-member"],
    ["accountMember.name", "Sample Member"],
    ["accountMember.email", "member@example.com"],
    ["selectedAccount.name", "Sample Company A"],
    ["selectedAccount.id", "sample-account-a"],
    ["lapsedAccount.name", ""],
    ["lapsedAccount.id", ""],
  ] as const)("resolves %s against the selected-account context", (field, expected) => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
    const { container } = render(<EPAccountField field={field} />);
    expect(container.textContent).toBe(expected);
  });

  it("resolves lapsed account fields against the lapsed fixture", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_LAPSED);
    const { container: nameContainer } = render(
      <EPAccountField field="lapsedAccount.name" />
    );
    expect(nameContainer.textContent).toBe("Sample Company A");

    const { container: idContainer } = render(
      <EPAccountField field="lapsedAccount.id" />
    );
    expect(idContainer.textContent).toBe("sample-account-a");
  });

  it("renders an empty string when selectedAccount has no name", () => {
    mockUseSelector.mockReturnValue({
      ...MOCK_ACCOUNT_SELECTED,
      selectedAccount: { id: "acct-1" },
    });
    const { container } = render(
      <EPAccountField field="selectedAccount.name" />
    );
    expect(container.textContent).toBe("");
  });

  it("renders an empty member name and email for an id-only member", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_LAPSED);
    const { container: nameContainer } = render(
      <EPAccountField field="accountMember.name" />
    );
    expect(nameContainer.textContent).toBe("");
    const { container: emailContainer } = render(
      <EPAccountField field="accountMember.email" />
    );
    expect(emailContainer.textContent).toBe("");
    expect(
      nameContainer.querySelector("[data-ep-account-field]")
    ).not.toBeNull();
  });

  it("renders an empty member name and email for an anonymous shopper", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_ANONYMOUS);
    const { container } = render(
      <EPAccountField field="accountMember.email" />
    );
    expect(container.textContent).toBe("");
  });

  it("renders an empty member name while the account is loading", () => {
    mockUseSelector.mockReturnValue({
      ...MOCK_ACCOUNT_SELECTED,
      accountMember: null,
      isLoading: true,
    });
    const { container } = render(
      <EPAccountField field="accountMember.name" />
    );
    expect(container.textContent).toBe("");
  });

  it("renders an empty string when the member profile omits email", () => {
    mockUseSelector.mockReturnValue({
      ...MOCK_ACCOUNT_SELECTED,
      accountMember: { id: "sample-member", name: "Sample Member" },
    });
    const { container } = render(
      <EPAccountField field="accountMember.email" />
    );
    expect(container.textContent).toBe("");
  });

  it("renders an empty string for selected account fields when none is selected", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_ANONYMOUS);
    const { container } = render(
      <EPAccountField field="selectedAccount.name" />
    );
    expect(container.querySelector("[data-ep-account-field]")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("applies className on the span", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
    const { container } = render(
      <EPAccountField field="selectedAccount.name" className="my-field" />
    );
    expect(
      container.querySelector("[data-ep-account-field]")?.className
    ).toContain("my-field");
  });

  describe("registration", () => {
    it("pins parentComponentName and field choices", () => {
      expect(epAccountFieldMeta.name).toBe("plasmic-commerce-ep-account-field");
      expect(epAccountFieldMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-provider"
      );
      expect(epAccountFieldMeta.importName).toBe("EPAccountField");
      const field = (epAccountFieldMeta.props as any).field;
      expect(field.options).toEqual([
        { label: "Member id", value: "accountMember.id" },
        { label: "Member name", value: "accountMember.name" },
        { label: "Member email", value: "accountMember.email" },
        { label: "Selected account name", value: "selectedAccount.name" },
        { label: "Selected account id", value: "selectedAccount.id" },
        { label: "Lapsed account name", value: "lapsedAccount.name" },
        { label: "Lapsed account id", value: "lapsedAccount.id" },
      ]);
      expect(field.defaultValue).toBe("selectedAccount.name");
    });

    it("registers member name and email and no other member profile fields", () => {
      const values = (epAccountFieldMeta.props as any).field.options.map(
        (o: { value: string }) => o.value
      );
      expect(values).toEqual(
        expect.arrayContaining(["accountMember.name", "accountMember.email"])
      );
      expect(values).not.toEqual(
        expect.arrayContaining([
          "accountMember.username",
          "accountMember.givenName",
          "accountMember.middleName",
          "accountMember.familyName",
          "accountMember.firstName",
          "accountMember.lastName",
        ])
      );
    });

    it("does not register a Field-owned previewState or raw state choice", () => {
      expect((epAccountFieldMeta.props as any).previewState).toBeUndefined();
      const values = (epAccountFieldMeta.props as any).field.options.map(
        (o: { value: string }) => o.value
      );
      expect(values).not.toContain("state");
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountField(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountField,
        epAccountFieldMeta
      );
    });
  });
});
