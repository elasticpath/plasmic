/**
 * @jest-environment jsdom
 *
 * EPAccountProvider — maps shopper-session identity into `$ctx.account`.
 * previewState is Studio-only and never overrides a live runtime session.
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
import { act, render, screen, waitFor } from "@testing-library/react";
import { ShopperContext } from "../../shopper-context/ShopperContext";
import {
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_LAPSED,
  MOCK_ACCOUNT_MEMBER_ONLY,
  MOCK_ACCOUNT_SELECTED,
} from "../../utils/design-time-data";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPAccountProvider,
  registerEPAccountProvider,
  epAccountProviderMeta,
  accountContextFromSession,
  previewAccountContext,
  toAccountRef,
  deriveAccountState,
  normalizeAccountRoster,
} = require("../EPAccountProvider");

function publishedAccount() {
  const dp = screen.getByTestId("data-provider-account");
  return JSON.parse(dp.getAttribute("data-value")!);
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(body),
  });
}

function mockSessionAndRoster(
  session: unknown,
  roster: unknown = { accounts: [], total: 0 }
) {
  const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
    if (String(url).endsWith("/get-session")) {
      return jsonResponse({ session });
    }
    if (String(url).includes("/account/roster")) {
      expect(init?.method).toBe("POST");
      return jsonResponse(roster);
    }
    return jsonResponse({}, false);
  });
  (global as unknown as { fetch: typeof fetch }).fetch =
    fetchImpl as typeof fetch;
  return fetchImpl;
}

describe("accountContextFromSession", () => {
  it("derives anonymous when no member is present", () => {
    expect(accountContextFromSession({})).toEqual({
      state: "anonymous",
      accountMember: null,
      selectedAccount: null,
      accountRoster: { accounts: [], total: 0 },
      lapsedAccount: null,
      isLoading: false,
    });
  });

  it("derives memberOnly when a member has no organisation", () => {
    expect(
      accountContextFromSession({ epMemberId: "member-1" })
    ).toEqual({
      state: "memberOnly",
      accountMember: { id: "member-1" },
      selectedAccount: null,
      accountRoster: { accounts: [], total: 0 },
      lapsedAccount: null,
      isLoading: false,
    });
  });

  it("derives selected from epAccount and keeps name optional", () => {
    expect(
      accountContextFromSession({
        epMemberId: "member-1",
        epAccount: { id: "acct-1" },
      })
    ).toEqual({
      state: "selected",
      accountMember: { id: "member-1" },
      selectedAccount: { id: "acct-1" },
      accountRoster: { accounts: [], total: 0 },
      lapsedAccount: null,
      isLoading: false,
    });
  });

  it("derives lapsed from epLapsedAccount", () => {
    expect(
      accountContextFromSession({
        epMemberId: "member-1",
        epLapsedAccount: { id: "acct-1", name: "Acme" },
      })
    ).toEqual({
      state: "lapsed",
      accountMember: { id: "member-1" },
      selectedAccount: null,
      accountRoster: { accounts: [], total: 0 },
      lapsedAccount: { id: "acct-1", name: "Acme" },
      isLoading: false,
    });
  });

  it("attaches a paginated roster without treating total as accounts.length", () => {
    const roster = {
      accounts: [{ id: "acct-1", name: "Acme" }],
      total: 9,
    };
    expect(
      accountContextFromSession({ epMemberId: "member-1" }, roster)
        .accountRoster
    ).toEqual(roster);
  });

  it("does not copy tokens or expiry from the session envelope", () => {
    const mapped = accountContextFromSession({
      epMemberId: "member-1",
      epAccount: {
        id: "acct-1",
        name: "Acme",
        token: "secret-token",
        expires: 123,
      } as any,
    });
    const json = JSON.stringify(mapped);
    expect(json).not.toMatch(/token/i);
    expect(json).not.toMatch(/expires/i);
    expect(mapped.selectedAccount).toEqual({ id: "acct-1", name: "Acme" });
  });
});

describe("toAccountRef / roster helpers", () => {
  it("omits name when the session does not send one", () => {
    expect(toAccountRef({ id: "acct-1" })).toEqual({ id: "acct-1" });
  });

  it("returns null without a string id", () => {
    expect(toAccountRef({ name: "Acme" })).toBeNull();
    expect(toAccountRef(null)).toBeNull();
  });

  it("keeps roster total independent of the current page length", () => {
    expect(
      normalizeAccountRoster({
        accounts: [{ id: "acct-1" }, { id: "acct-2", name: "South" }],
        total: 40,
      })
    ).toEqual({
      accounts: [{ id: "acct-1" }, { id: "acct-2", name: "South" }],
      total: 40,
    });
  });

  it("derives mutually exclusive states", () => {
    expect(
      deriveAccountState({
        accountMember: null,
        selectedAccount: null,
        lapsedAccount: null,
      })
    ).toBe("anonymous");
    expect(
      deriveAccountState({
        accountMember: { id: "m" },
        selectedAccount: null,
        lapsedAccount: null,
      })
    ).toBe("memberOnly");
    expect(
      deriveAccountState({
        accountMember: { id: "m" },
        selectedAccount: { id: "a" },
        lapsedAccount: null,
      })
    ).toBe("selected");
    expect(
      deriveAccountState({
        accountMember: { id: "m" },
        selectedAccount: null,
        lapsedAccount: { id: "a" },
      })
    ).toBe("lapsed");
  });
});

describe("previewAccountContext", () => {
  it("uses the selected-account mock floor for auto", () => {
    expect(previewAccountContext("auto")).toEqual(MOCK_ACCOUNT_SELECTED);
  });

  it("uses the selected-account mock floor for an unrecognized previewState", () => {
    expect(previewAccountContext("accountSelected")).toEqual(
      MOCK_ACCOUNT_SELECTED
    );
  });

  it.each([
    ["anonymous", MOCK_ACCOUNT_ANONYMOUS],
    ["memberOnly", MOCK_ACCOUNT_MEMBER_ONLY],
    ["selected", MOCK_ACCOUNT_SELECTED],
    ["lapsed", MOCK_ACCOUNT_LAPSED],
  ] as const)("honours explicit %s", (state, fixture) => {
    expect(previewAccountContext(state)).toEqual(fixture);
  });
});

describe("EPAccountProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(
      () => new Promise(() => {})
    ) as typeof fetch;
  });

  afterEach(() => {
    delete (global as unknown as { fetch?: typeof fetch }).fetch;
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

  it("publishes a loading context until the session arrives", async () => {
    mockSessionAndRoster({});
    render(
      <EPAccountProvider>
        <span>child</span>
      </EPAccountProvider>
    );
    expect(publishedAccount()).toEqual({
      ...MOCK_ACCOUNT_ANONYMOUS,
      isLoading: true,
    });
    await waitFor(() => {
      expect(publishedAccount()).toEqual(MOCK_ACCOUNT_ANONYMOUS);
    });
  });

  it("publishes anonymous when get-session fails", async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(() =>
      jsonResponse({}, false)
    ) as unknown as typeof fetch;
    render(
      <EPAccountProvider>
        <span>child</span>
      </EPAccountProvider>
    );
    await waitFor(() => {
      expect(publishedAccount()).toEqual(MOCK_ACCOUNT_ANONYMOUS);
    });
  });

  it("reads the session from the ShopperContext basePath", async () => {
    const fetchImpl = mockSessionAndRoster({ epMemberId: "member-1" });
    render(
      <ShopperContext basePath="/api/store">
        <EPAccountProvider>
          <span>child</span>
        </EPAccountProvider>
      </ShopperContext>
    );
    await waitFor(() => {
      expect(publishedAccount().state).toBe("memberOnly");
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/store/get-session",
      expect.anything()
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/store/ep/account/roster",
      expect.anything()
    );
  });

  it("does not publish the previous identity after the basePath changes", async () => {
    const fetchImpl = mockSessionAndRoster({ epMemberId: "member-a" });
    const pending = new Promise<never>(() => {});
    const baseFetch = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation((url: string, init?: RequestInit) =>
      String(url).startsWith("/api/b/") ? pending : baseFetch(url, init)
    );
    const tree = (basePath: string) => (
      <ShopperContext basePath={basePath}>
        <EPAccountProvider>
          <span>child</span>
        </EPAccountProvider>
      </ShopperContext>
    );

    const { rerender } = render(tree("/api/a"));
    await waitFor(() => {
      expect(publishedAccount().accountMember).toEqual({ id: "member-a" });
    });

    rerender(tree("/api/b"));
    expect(publishedAccount()).toEqual({
      ...MOCK_ACCOUNT_ANONYMOUS,
      isLoading: true,
    });
  });

  it("maps a live selected session and roster at runtime", async () => {
    const fetchImpl = mockSessionAndRoster(
      {
        epMemberId: "member-1",
        epAccount: { id: "acct-1", name: "Acme", token: "secret" },
        epAccessToken: "anon-token",
      },
      {
        accounts: [
          { id: "acct-1", name: "Acme" },
          { id: "acct-2", token: "nope" },
        ],
        total: 9,
      }
    );

    render(
      <EPAccountProvider previewState="anonymous">
        <span>child</span>
      </EPAccountProvider>
    );

    await waitFor(() => {
      expect(publishedAccount().state).toBe("selected");
    });

    const published = publishedAccount();
    expect(published).toEqual({
      state: "selected",
      accountMember: { id: "member-1" },
      selectedAccount: { id: "acct-1", name: "Acme" },
      accountRoster: {
        accounts: [{ id: "acct-1", name: "Acme" }, { id: "acct-2" }],
        total: 9,
      },
      lapsedAccount: null,
      isLoading: false,
    });
    expect(JSON.stringify(published)).not.toMatch(/token/i);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ep/get-session",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ep/ep/account/roster",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("does not let previewState override runtime identity", async () => {
    mockSessionAndRoster({ epMemberId: "member-live" });

    render(
      <EPAccountProvider previewState="selected">
        <span>child</span>
      </EPAccountProvider>
    );

    await waitFor(() => {
      expect(publishedAccount()).toEqual({
        state: "memberOnly",
        accountMember: { id: "member-live" },
        selectedAccount: null,
        accountRoster: { accounts: [], total: 0 },
        lapsedAccount: null,
        isLoading: false,
      });
    });
  });

  it("maps a live lapsed session at runtime", async () => {
    mockSessionAndRoster({
      epMemberId: "member-1",
      epLapsedAccount: { id: "acct-1", name: "Acme" },
    });

    render(
      <EPAccountProvider>
        <span>child</span>
      </EPAccountProvider>
    );

    await waitFor(() => {
      expect(publishedAccount().state).toBe("lapsed");
    });
    expect(publishedAccount().lapsedAccount).toEqual({
      id: "acct-1",
      name: "Acme",
    });
    expect(publishedAccount().selectedAccount).toBeNull();
  });

  it("maps a live anonymous session without fetching the roster", async () => {
    const fetchImpl = mockSessionAndRoster({});

    render(
      <EPAccountProvider>
        <span>child</span>
      </EPAccountProvider>
    );

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    expect(publishedAccount().state).toBe("anonymous");
    expect(fetchImpl.mock.calls.some(([url]: [string]) => String(url).includes("roster"))).toBe(
      false
    );
  });

  describe("design-time preview", () => {
    beforeEach(() => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
    });

    it.each([
      ["anonymous", MOCK_ACCOUNT_ANONYMOUS],
      ["memberOnly", MOCK_ACCOUNT_MEMBER_ONLY],
      ["selected", MOCK_ACCOUNT_SELECTED],
      ["lapsed", MOCK_ACCOUNT_LAPSED],
    ] as const)("publishes %s from previewState", (previewState, fixture) => {
      const fetchImpl = mockSessionAndRoster({ epMemberId: "ignored" });
      render(
        <EPAccountProvider previewState={previewState}>
          <span>child</span>
        </EPAccountProvider>
      );

      expect(publishedAccount()).toEqual(fixture);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("uses live identity for auto when a member is present", async () => {
      mockSessionAndRoster(
        { epMemberId: "member-live", epAccount: { id: "acct-live" } },
        { accounts: [{ id: "acct-live" }], total: 1 }
      );

      render(
        <EPAccountProvider previewState="auto">
          <span>child</span>
        </EPAccountProvider>
      );

      expect(publishedAccount()).toEqual(MOCK_ACCOUNT_SELECTED);

      await waitFor(() => {
        expect(publishedAccount().accountMember).toEqual({
          id: "member-live",
        });
      });
      expect(publishedAccount().state).toBe("selected");
      expect(publishedAccount().selectedAccount).toEqual({ id: "acct-live" });
    });

    it("keeps the selected mock floor for auto when the session is anonymous", async () => {
      mockSessionAndRoster({});

      render(
        <EPAccountProvider previewState="auto">
          <span>child</span>
        </EPAccountProvider>
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(publishedAccount()).toEqual(MOCK_ACCOUNT_SELECTED);
    });
  });

  describe("published contract", () => {
    it("exposes roster as a paginated {accounts, total} page", () => {
      expect(MOCK_ACCOUNT_SELECTED.accountRoster).toEqual({
        accounts: [
          { id: "sample-account-a", name: "Sample Company A" },
          { id: "sample-account-b", name: "Sample Company B" },
        ],
        total: 5,
      });
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
      ).toEqual(["auto", "anonymous", "memberOnly", "selected", "lapsed"]);
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
