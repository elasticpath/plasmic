/**
 * @jest-environment jsdom
 *
 * EPAccountGate — shows children when `$ctx.account` matches `when`.
 * Reads the Provider's published context; it does not select fixtures.
 */

const mockUseSelector = jest.fn().mockReturnValue(undefined);

jest.mock("@plasmicapp/host", () => ({
  useSelector: (...args: any[]) => mockUseSelector(...args),
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
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
  MOCK_ACCOUNT_AUTHENTICATED,
  MOCK_ACCOUNT_LAPSED,
  MOCK_ACCOUNT_SELECTED,
} from "../../utils/design-time-data";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPAccountGate,
  registerEPAccountGate,
  epAccountGateMeta,
} = require("../EPAccountGate");

function renderGate(when: string) {
  return render(
    <EPAccountGate when={when}>
      <span data-testid="gated">visible</span>
    </EPAccountGate>
  );
}

describe("EPAccountGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockReturnValue(undefined);
  });

  it("reads the account DataProvider key", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
    renderGate("authenticated");
    expect(mockUseSelector).toHaveBeenCalledWith("account");
  });

  it("renders nothing when no account context is published", () => {
    const { queryByTestId } = renderGate("anonymous");
    expect(queryByTestId("gated")).toBeNull();
  });

  it("renders matching children without a wrapper element", () => {
    mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
    const { container, getByTestId } = renderGate("authenticated");
    const child = getByTestId("gated");
    expect(child.textContent).toBe("visible");
    expect(container.firstChild).toBe(child);
  });

  describe("when=authenticated", () => {
    it.each([
      ["authenticated unselected", MOCK_ACCOUNT_AUTHENTICATED, true],
      ["account selected", MOCK_ACCOUNT_SELECTED, true],
      ["lapsed", MOCK_ACCOUNT_LAPSED, true],
      ["anonymous", MOCK_ACCOUNT_ANONYMOUS, false],
    ] as const)("%s → %s", (_label, account, visible) => {
      mockUseSelector.mockReturnValue(account);
      const { queryByTestId } = renderGate("authenticated");
      expect(Boolean(queryByTestId("gated"))).toBe(visible);
    });
  });

  describe("when=anonymous", () => {
    it("shows on the anonymous shape", () => {
      mockUseSelector.mockReturnValue(MOCK_ACCOUNT_ANONYMOUS);
      const { getByTestId } = renderGate("anonymous");
      expect(getByTestId("gated").textContent).toBe("visible");
    });

    it("hides when a member is present", () => {
      mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
      const { queryByTestId } = renderGate("anonymous");
      expect(queryByTestId("gated")).toBeNull();
    });
  });

  describe("when=selected", () => {
    it("shows only when selectedAccount is set", () => {
      mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
      const { getByTestId } = renderGate("selected");
      expect(getByTestId("gated")).toBeTruthy();
    });

    it("hides for authenticated-without-selection and lapsed", () => {
      mockUseSelector.mockReturnValue(MOCK_ACCOUNT_AUTHENTICATED);
      expect(renderGate("selected").queryByTestId("gated")).toBeNull();

      mockUseSelector.mockReturnValue(MOCK_ACCOUNT_LAPSED);
      expect(renderGate("selected").queryByTestId("gated")).toBeNull();
    });
  });

  describe("when=lapsed", () => {
    it("shows only when lapsedAccount is set", () => {
      mockUseSelector.mockReturnValue(MOCK_ACCOUNT_LAPSED);
      const { getByTestId } = renderGate("lapsed");
      expect(getByTestId("gated")).toBeTruthy();
    });

    it("hides when the organisation is still selected", () => {
      mockUseSelector.mockReturnValue(MOCK_ACCOUNT_SELECTED);
      const { queryByTestId } = renderGate("lapsed");
      expect(queryByTestId("gated")).toBeNull();
    });
  });

  describe("registration", () => {
    it("pins parentComponentName and when options", () => {
      expect(epAccountGateMeta.name).toBe("plasmic-commerce-ep-account-gate");
      expect(epAccountGateMeta.parentComponentName).toBe(
        "plasmic-commerce-ep-account-provider"
      );
      expect(epAccountGateMeta.importName).toBe("EPAccountGate");
      expect(epAccountGateMeta.styleSections).toBe(false);
      const when = (epAccountGateMeta.props as any).when;
      expect(
        when.options.map((o: { label: string; value: string }) => o)
      ).toEqual([
        { label: "Authenticated", value: "authenticated" },
        { label: "Anonymous", value: "anonymous" },
        { label: "Account selected", value: "selected" },
        { label: "Lapsed account", value: "lapsed" },
      ]);
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountGate(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountGate,
        epAccountGateMeta
      );
    });
  });
});
