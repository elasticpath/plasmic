/**
 * @jest-environment jsdom
 *
 * EPAccountProvider — publishes `$ctx.account` from preview fixtures.
 * Fixtures are canvas-only (EPCheckoutProvider). Runtime is always
 * anonymous until identity architecture lands. No session, login, or ep.* calls.
 */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  useSelector: jest.fn().mockReturnValue(undefined),
  usePlasmicCanvasContext: (...args: any[]) =>
    mockUsePlasmicCanvasContext(...args),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen } from "@testing-library/react";
import {
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_AUTHENTICATED,
  MOCK_ACCOUNT_LAPSED,
  MOCK_ACCOUNT_SELECTED,
} from "../../utils/design-time-data";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPAccountProvider,
  registerEPAccountProvider,
  epAccountProviderMeta,
  resolveAccountContext,
} = require("../EPAccountProvider");

function publishedAccount() {
  const dp = screen.getByTestId("data-provider-account");
  return JSON.parse(dp.getAttribute("data-value")!);
}

describe("resolveAccountContext", () => {
  it("is anonymous for auto outside the editor", () => {
    expect(resolveAccountContext("auto", false)).toEqual(MOCK_ACCOUNT_ANONYMOUS);
  });

  it("ignores explicit previewState outside the editor", () => {
    expect(resolveAccountContext("selected", false)).toEqual(
      MOCK_ACCOUNT_ANONYMOUS
    );
    expect(resolveAccountContext("lapsed", false)).toEqual(
      MOCK_ACCOUNT_ANONYMOUS
    );
  });

  it("uses the selected-account mock floor for auto in the editor", () => {
    expect(resolveAccountContext("auto", true)).toEqual(MOCK_ACCOUNT_SELECTED);
  });

  it.each([
    ["anonymous", MOCK_ACCOUNT_ANONYMOUS],
    ["authenticated", MOCK_ACCOUNT_AUTHENTICATED],
    ["selected", MOCK_ACCOUNT_SELECTED],
    ["lapsed", MOCK_ACCOUNT_LAPSED],
  ] as const)("honours explicit %s in the editor", (state, fixture) => {
    expect(resolveAccountContext(state, true)).toEqual(fixture);
  });
});

describe("EPAccountProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  it("renders children and publishes $ctx.account", () => {
    render(
      <EPAccountProvider>
        <span data-testid="child">Hello</span>
      </EPAccountProvider>
    );

    expect(screen.getByTestId("child").textContent).toBe("Hello");
    expect(screen.getByTestId("data-provider-account")).toBeTruthy();
  });

  it("applies className to the wrapper", () => {
    const { container } = render(
      <EPAccountProvider className="my-account">
        <span>child</span>
      </EPAccountProvider>
    );

    const root = container.querySelector("[data-ep-account-provider]");
    expect(root?.className).toContain("my-account");
  });

  it("publishes the anonymous shape for auto at runtime", () => {
    render(
      <EPAccountProvider>
        <span>child</span>
      </EPAccountProvider>
    );

    expect(publishedAccount()).toEqual(MOCK_ACCOUNT_ANONYMOUS);
  });

  it("ignores explicit previewState at runtime", () => {
    render(
      <EPAccountProvider previewState="selected">
        <span>child</span>
      </EPAccountProvider>
    );

    expect(publishedAccount()).toEqual(MOCK_ACCOUNT_ANONYMOUS);
  });

  it("does not fetch a session or account endpoint", () => {
    const fetchImpl = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch =
      fetchImpl as typeof fetch;

    render(
      <EPAccountProvider previewState="selected">
        <span>child</span>
      </EPAccountProvider>
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    delete (global as unknown as { fetch?: typeof fetch }).fetch;
  });

  describe("design-time preview", () => {
    beforeEach(() => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
    });

    it.each([
      ["anonymous", MOCK_ACCOUNT_ANONYMOUS],
      ["authenticated", MOCK_ACCOUNT_AUTHENTICATED],
      ["selected", MOCK_ACCOUNT_SELECTED],
      ["lapsed", MOCK_ACCOUNT_LAPSED],
    ] as const)("publishes %s", (previewState, fixture) => {
      render(
        <EPAccountProvider previewState={previewState}>
          <span>child</span>
        </EPAccountProvider>
      );

      expect(publishedAccount()).toEqual(fixture);
    });

    it("publishes the selected-account fixture for auto in the editor", () => {
      render(
        <EPAccountProvider previewState="auto">
          <span>child</span>
        </EPAccountProvider>
      );

      expect(publishedAccount()).toEqual(MOCK_ACCOUNT_SELECTED);
    });
  });

  describe("published contract", () => {
    it("never includes a token, expiry, or member profile fields", () => {
      const fixtures = [
        MOCK_ACCOUNT_ANONYMOUS,
        MOCK_ACCOUNT_AUTHENTICATED,
        MOCK_ACCOUNT_SELECTED,
        MOCK_ACCOUNT_LAPSED,
      ];
      for (const fixture of fixtures) {
        const json = JSON.stringify(fixture);
        expect(json).not.toMatch(/token/i);
        expect(json).not.toMatch(/expires/i);
        expect(json).not.toMatch(/firstName/);
        expect(json).not.toMatch(/lastName/);
        expect(json).not.toMatch(/email/);
        if (fixture.accountMember) {
          expect(Object.keys(fixture.accountMember)).toEqual(["id"]);
        }
      }
    });

    it("exposes roster as id/name only on signed-in fixtures", () => {
      expect(MOCK_ACCOUNT_SELECTED.accountRoster).toEqual([
        { id: "sample-account-a", name: "Sample Company A" },
        { id: "sample-account-b", name: "Sample Company B" },
      ]);
    });
  });

  describe("registration", () => {
    it("has the Accounts provider meta shape and no refActions", () => {
      expect(epAccountProviderMeta.name).toBe(
        "plasmic-commerce-ep-account-provider"
      );
      expect(epAccountProviderMeta.displayName).toBe("EP Account Provider");
      expect(epAccountProviderMeta.providesData).toBe(true);
      expect(epAccountProviderMeta.importName).toBe("EPAccountProvider");
      expect(epAccountProviderMeta.refActions).toBeUndefined();
      const previewState = (epAccountProviderMeta.props as any).previewState;
      expect(
        previewState.options.map((o: { value: string }) => o.value)
      ).toEqual([
        "auto",
        "anonymous",
        "authenticated",
        "selected",
        "lapsed",
      ]);
    });

    it("registers the component with its meta", () => {
      const loader = { registerComponent: jest.fn() };
      registerEPAccountProvider(loader);
      expect(loader.registerComponent).toHaveBeenCalledWith(
        EPAccountProvider,
        epAccountProviderMeta
      );
    });
  });
});
