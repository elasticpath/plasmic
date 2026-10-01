/**
 * @jest-environment jsdom
 *
 * EPAccountProvider — maps shopper-session identity into `$ctx.account`.
 * previewState is Studio-only and never overrides a live runtime session.
 */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  const AccountCtx = React.createContext(undefined);
  return {
    DataProvider: ({ children, name, data }: any) =>
      React.createElement(
        "div",
        {
          "data-testid": `data-provider-${name}`,
          "data-value": JSON.stringify(data),
        },
        name === "account"
          ? React.createElement(AccountCtx.Provider, { value: data }, children)
          : children
      ),
    useSelector: (key: string) => {
      const data = React.useContext(AccountCtx);
      return key === "account" ? data : undefined;
    },
    usePlasmicCanvasContext: (...args: any[]) =>
      mockUsePlasmicCanvasContext(...args),
  };
});

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
  useAccountReload,
  RELOAD_RETRY_BACKOFF_MS,
} = require("../EPAccountProvider");

function ReloadHandle(props: { handle: { reload?: () => Promise<void> } }) {
  props.handle.reload = useAccountReload();
  return null;
}
const { EPAccountGate } = require("../EPAccountGate");

interface AccountActions {
  logout(): Promise<void>;
  selectAccount(accountId: string): Promise<void>;
}

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
      isSelecting: false,
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
      isSelecting: false,
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
      isSelecting: false,
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
      isSelecting: false,
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
      isSelecting: false,
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
        isSelecting: false,
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

  describe("logout", () => {
    function installLogoutFetch(baseSession: Record<string, unknown>) {
      let getSessionCount = 0;
      let releaseReload: () => void = () => {};
      const reloadGate = new Promise<void>((resolve) => {
        releaseReload = resolve;
      });
      const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/get-session")) {
          getSessionCount += 1;
          if (getSessionCount === 1) {
            return jsonResponse({ session: baseSession });
          }
          return reloadGate.then(() => jsonResponse({ session: {} }));
        }
        if (target.includes("/account/logout")) {
          expect(init?.method).toBe("POST");
          return jsonResponse({ session: {} });
        }
        if (target.includes("/account/roster")) {
          return jsonResponse({ accounts: [], total: 0 });
        }
        return jsonResponse({}, false);
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;
      return {
        fetchImpl,
        releaseReload,
        logoutCalls: () =>
          fetchImpl.mock.calls.filter(([url]) =>
            String(url).includes("/account/logout")
          ),
      };
    }

    it("calls logout on the identity client and reloads to anonymous without remounting", async () => {
      const { fetchImpl, releaseReload, logoutCalls } = installLogoutFetch({
        epMemberId: "member-1",
        epAccount: { id: "acct-1", name: "Acme" },
      });
      const ref = React.createRef<AccountActions>();
      const { container } = render(
        <EPAccountProvider ref={ref}>
          <EPAccountGate when="anonymous">
            <span data-testid="signed-out">Signed out</span>
          </EPAccountGate>
          <EPAccountGate when="authenticated">
            <span data-testid="signed-in">Signed in</span>
          </EPAccountGate>
        </EPAccountProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("signed-in")).toBeTruthy();
      });
      expect(screen.queryByTestId("signed-out")).toBeNull();
      const root = container.querySelector("[data-ep-account-provider]");

      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = ref.current!.logout();
      });

      expect(logoutCalls()).toHaveLength(1);
      expect(String(logoutCalls()[0][0])).toBe("/api/ep/ep/account/logout");
      expect(publishedAccount().isLoading).toBe(true);
      expect(screen.queryByTestId("signed-out")).toBeNull();
      expect(screen.queryByTestId("signed-in")).toBeNull();
      expect(container.querySelector("[data-ep-account-provider]")).toBe(root);
      expect(
        fetchImpl.mock.calls.filter(([url]) =>
          String(url).endsWith("/get-session")
        )
      ).toHaveLength(2);

      await act(async () => {
        releaseReload();
        await pending;
      });
      await waitFor(() => {
        expect(publishedAccount()).toEqual(MOCK_ACCOUNT_ANONYMOUS);
      });
      expect(screen.getByTestId("signed-out")).toBeTruthy();
      expect(screen.queryByTestId("signed-in")).toBeNull();
    });

    it("posts logout to the ShopperContext basePath", async () => {
      const { releaseReload, logoutCalls } = installLogoutFetch({
        epMemberId: "member-1",
      });
      const ref = React.createRef<AccountActions>();
      render(
        <ShopperContext basePath="/api/store">
          <EPAccountProvider ref={ref}>
            <span>child</span>
          </EPAccountProvider>
        </ShopperContext>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });

      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = ref.current!.logout();
      });

      expect(String(logoutCalls()[0][0])).toBe("/api/store/ep/account/logout");
      const sessionUrls = (
        (global as unknown as { fetch: jest.Mock }).fetch as jest.Mock
      ).mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.endsWith("/get-session"));
      expect(sessionUrls.every((url) => url.startsWith("/api/store/"))).toBe(
        true
      );
      await act(async () => {
        releaseReload();
        await pending;
      });
    });

    it("does not call logout in the canvas", async () => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      const { logoutCalls } = installLogoutFetch({
        epMemberId: "member-1",
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().accountMember).toEqual({ id: "member-1" });
      });

      await act(async () => {
        await ref.current!.logout();
      });

      expect(logoutCalls()).toEqual([]);
      expect(publishedAccount().accountMember).toEqual({ id: "member-1" });
      expect(publishedAccount().isLoading).toBe(false);
    });
  });

  describe("selectAccount", () => {
    const roster = {
      accounts: [
        { id: "acct-a", name: "Acme" },
        { id: "acct-b", name: "Northwind" },
      ],
      total: 2,
    };

    function installSelectFetch(options: {
      initialSession: Record<string, unknown>;
      nextSession?: Record<string, unknown>;
      selectOk?: boolean;
      selectCode?: string;
      holdReload?: boolean;
      holdSelect?: boolean;
    }) {
      let getSessionCount = 0;
      let releaseReload: () => void = () => {};
      let releaseSelect: () => void = () => {};
      const reloadGate = new Promise<void>((resolve) => {
        releaseReload = resolve;
      });
      const selectGate = new Promise<void>((resolve) => {
        releaseSelect = resolve;
      });
      const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/get-session")) {
          getSessionCount += 1;
          if (getSessionCount === 1) {
            return jsonResponse({ session: options.initialSession });
          }
          const body = { session: options.nextSession ?? {} };
          if (options.holdReload) {
            return reloadGate.then(() => jsonResponse(body));
          }
          return jsonResponse(body);
        }
        if (target.includes("/account/select")) {
          expect(init?.method).toBe("POST");
          const response =
            options.selectOk === false
              ? Promise.resolve({
                  ok: false,
                  status: 404,
                  json: () =>
                    Promise.resolve({
                      code: options.selectCode ?? "account_not_found",
                      error: options.selectCode ?? "account_not_found",
                      message: "selection failed",
                    }),
                })
              : jsonResponse({
                  session: options.nextSession ?? options.initialSession,
                });
          if (options.holdSelect) {
            return selectGate.then(() => response);
          }
          return response;
        }
        if (target.includes("/account/roster")) {
          return jsonResponse(roster);
        }
        return jsonResponse({}, false);
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;
      return {
        fetchImpl,
        releaseReload,
        releaseSelect,
        sessionReads: () =>
          fetchImpl.mock.calls.filter(([url]) =>
            String(url).endsWith("/get-session")
          ),
        selectCalls: () =>
          fetchImpl.mock.calls.filter(([url]) =>
            String(url).includes("/account/select")
          ),
      };
    }

    it("selects an organisation from memberOnly and reloads to selected", async () => {
      const { releaseReload, selectCalls, sessionReads } = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
        holdReload: true,
      });
      const ref = React.createRef<AccountActions>();
      const { container } = render(
        <EPAccountProvider ref={ref}>
          <EPAccountGate when="authenticated">
            <span data-testid="signed-in">Signed in</span>
          </EPAccountGate>
          <EPAccountGate when="selected">
            <span data-testid="selected">Selected</span>
          </EPAccountGate>
        </EPAccountProvider>
      );

      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });
      expect(screen.getByTestId("signed-in")).toBeTruthy();
      expect(screen.queryByTestId("selected")).toBeNull();
      const root = container.querySelector("[data-ep-account-provider]");

      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = ref.current!.selectAccount("acct-b");
      });

      expect(selectCalls()).toHaveLength(1);
      expect(String(selectCalls()[0][0])).toBe("/api/ep/ep/account/select");
      expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
        accountId: "acct-b",
      });
      expect(sessionReads()).toHaveLength(2);
      expect(publishedAccount().isLoading).toBe(true);
      expect(screen.queryByTestId("signed-in")).toBeNull();
      expect(screen.queryByTestId("selected")).toBeNull();
      expect(container.querySelector("[data-ep-account-provider]")).toBe(root);

      await act(async () => {
        releaseReload();
        await pending;
      });
      await waitFor(() => {
        expect(publishedAccount().state).toBe("selected");
      });
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
      expect(publishedAccount().accountRoster).toEqual(roster);
      expect(publishedAccount().accountMember).toEqual({ id: "member-1" });
      expect(screen.getByTestId("selected")).toBeTruthy();
      expect(screen.getByTestId("signed-in")).toBeTruthy();
    });

    it("switches from one selected account to another", async () => {
      const { selectCalls } = installSelectFetch({
        initialSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-a", name: "Acme" },
        },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <EPAccountGate when="selected">
            <span data-testid="selected">Selected</span>
          </EPAccountGate>
        </EPAccountProvider>
      );

      await waitFor(() => {
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-a",
          name: "Acme",
        });
      });

      await act(async () => {
        await ref.current!.selectAccount("acct-b");
      });

      expect(selectCalls()).toHaveLength(1);
      expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
        accountId: "acct-b",
      });
      expect(publishedAccount().state).toBe("selected");
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
      expect(publishedAccount().accountRoster).toEqual(roster);
      expect(screen.getByTestId("selected")).toBeTruthy();
    });

    it("does not select or reload when the account is already selected", async () => {
      const { selectCalls, sessionReads } = installSelectFetch({
        initialSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-a", name: "Acme" },
        },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );

      await waitFor(() => {
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-a",
          name: "Acme",
        });
      });
      const before = publishedAccount();
      expect(sessionReads()).toHaveLength(1);

      await act(async () => {
        await ref.current!.selectAccount("acct-a");
      });

      expect(selectCalls()).toEqual([]);
      expect(sessionReads()).toHaveLength(1);
      expect(publishedAccount()).toEqual(before);
      expect(publishedAccount().isLoading).toBe(false);

      await act(async () => {
        await ref.current!.selectAccount("acct-b");
      });

      expect(selectCalls()).toHaveLength(1);
      expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
        accountId: "acct-b",
      });
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
    });

    it("ignores a return to the selected account while another selection is in flight", async () => {
      const { releaseSelect, selectCalls, sessionReads } = installSelectFetch({
        initialSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-a", name: "Acme" },
        },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
        holdSelect: true,
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-a",
          name: "Acme",
        });
      });
      expect(sessionReads()).toHaveLength(1);

      let first = "pending";
      let back = "pending";
      let firstDone: Promise<unknown> = Promise.resolve();
      await act(async () => {
        firstDone = ref.current!.selectAccount("acct-b").then(
          () => {
            first = "resolved";
          },
          () => {
            first = "rejected";
          }
        );
        void ref.current!.selectAccount("acct-a").then(
          () => {
            back = "resolved";
          },
          () => {
            back = "rejected";
          }
        );
      });

      expect(selectCalls()).toHaveLength(1);
      expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
        accountId: "acct-b",
      });
      expect(sessionReads()).toHaveLength(1);
      expect(back).toBe("resolved");
      expect(first).toBe("pending");
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-a",
        name: "Acme",
      });

      await act(async () => {
        releaseSelect();
        await firstDone;
      });

      expect(first).toBe("resolved");
      expect(selectCalls()).toHaveLength(1);
      expect(sessionReads()).toHaveLength(2);
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
      expect(publishedAccount().isLoading).toBe(false);
    });

    it("leaves the published account unchanged when selection fails", async () => {
      const { selectCalls, sessionReads } = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
        selectOk: false,
        selectCode: "account_not_found",
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <EPAccountGate when="authenticated">
            <span data-testid="signed-in">Signed in</span>
          </EPAccountGate>
          <EPAccountGate when="anonymous">
            <span data-testid="signed-out">Signed out</span>
          </EPAccountGate>
        </EPAccountProvider>
      );

      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });
      const before = publishedAccount();
      jest.useFakeTimers();
      try {
        let settled = "pending";
        await act(async () => {
          await ref.current!.selectAccount("acct-missing").then(
            () => {
              settled = "resolved";
            },
            () => {
              settled = "rejected";
            }
          );
        });

        expect(settled).toBe("rejected");
        expect(selectCalls()).toHaveLength(1);
        expect(sessionReads()).toHaveLength(1);
        expect(publishedAccount()).toEqual(before);
        expect(publishedAccount().isLoading).toBe(false);
        expect(screen.getByTestId("signed-in")).toBeTruthy();
        expect(screen.queryByTestId("signed-out")).toBeNull();

        await act(async () => {
          jest.advanceTimersByTime(RELOAD_RETRY_BACKOFF_MS[0]);
          await Promise.resolve();
        });

        expect(selectCalls()).toHaveLength(1);
        expect(sessionReads()).toHaveLength(1);
        expect(publishedAccount()).toEqual(before);
      } finally {
        jest.useRealTimers();
      }
    });

    it("retries the session read after a successful select when refresh fails", async () => {
      jest.useFakeTimers();
      const backoff = RELOAD_RETRY_BACKOFF_MS as readonly number[];
      const flushPromises = async () => {
        await act(async () => {
          for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
      };
      const advance = async (ms: number) => {
        await act(async () => {
          jest.advanceTimersByTime(ms);
        });
        await flushPromises();
      };

      try {
        let sessionReadsCount = 0;
        const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
          const target = String(url);
          if (target.endsWith("/get-session")) {
            sessionReadsCount += 1;
            if (sessionReadsCount === 1) {
              return jsonResponse({ session: { epMemberId: "member-1" } });
            }
            if (sessionReadsCount === 2) {
              return jsonResponse({ message: "unavailable" }, false);
            }
            return jsonResponse({
              session: {
                epMemberId: "member-1",
                epAccount: { id: "acct-b", name: "Northwind" },
              },
            });
          }
          if (target.includes("/account/select")) {
            expect(init?.method).toBe("POST");
            return jsonResponse({ session: {} });
          }
          if (target.includes("/account/roster")) {
            return jsonResponse(roster);
          }
          return jsonResponse({}, false);
        });
        (global as unknown as { fetch: typeof fetch }).fetch =
          fetchImpl as typeof fetch;

        const selectCalls = () =>
          fetchImpl.mock.calls.filter(([url]) =>
            String(url).includes("/account/select")
          );

        const ref = React.createRef<AccountActions>();
        render(
          <EPAccountProvider ref={ref}>
            <EPAccountGate when="anonymous">
              <span data-testid="signed-out">Signed out</span>
            </EPAccountGate>
            <EPAccountGate when="authenticated">
              <span data-testid="signed-in">Signed in</span>
            </EPAccountGate>
          </EPAccountProvider>
        );
        await flushPromises();
        expect(publishedAccount().state).toBe("memberOnly");
        expect(screen.getByTestId("signed-in")).toBeTruthy();

        let settled = "pending";
        let pending: Promise<void> = Promise.resolve();
        await act(async () => {
          pending = ref.current!.selectAccount("acct-b").then(
            () => {
              settled = "resolved";
            },
            () => {
              settled = "rejected";
            }
          );
        });
        await flushPromises();
        await act(async () => {
          await pending;
        });

        expect(settled).toBe("rejected");
        expect(selectCalls()).toHaveLength(1);
        expect(sessionReadsCount).toBe(2);
        expect(publishedAccount().isLoading).toBe(true);
        expect(publishedAccount().isSelecting).toBe(false);
        expect(screen.queryByTestId("signed-in")).toBeNull();
        expect(screen.queryByTestId("signed-out")).toBeNull();

        await advance(backoff[0] - 1);
        expect(sessionReadsCount).toBe(2);
        expect(selectCalls()).toHaveLength(1);

        await advance(1);
        expect(sessionReadsCount).toBe(3);
        expect(selectCalls()).toHaveLength(1);
        expect(publishedAccount().state).toBe("selected");
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-b",
          name: "Northwind",
        });
        expect(publishedAccount().isLoading).toBe(false);
        expect(publishedAccount().isSelecting).toBe(false);
        expect(screen.getByTestId("signed-in")).toBeTruthy();
        expect(screen.queryByTestId("signed-out")).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not drop the previously selected account while a failed refresh is retrying", async () => {
      jest.useFakeTimers();
      const flushPromises = async () => {
        await act(async () => {
          for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
      };

      try {
        let sessionReadsCount = 0;
        const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
          const target = String(url);
          if (target.endsWith("/get-session")) {
            sessionReadsCount += 1;
            if (sessionReadsCount === 1) {
              return jsonResponse({
                session: {
                  epMemberId: "member-1",
                  epAccount: { id: "acct-a", name: "Acme" },
                },
              });
            }
            if (sessionReadsCount === 2) {
              return jsonResponse({ message: "unavailable" }, false);
            }
            return jsonResponse({
              session: {
                epMemberId: "member-1",
                epAccount: { id: "acct-a", name: "Acme" },
              },
            });
          }
          if (target.includes("/account/select")) {
            expect(init?.method).toBe("POST");
            return jsonResponse({ session: {} });
          }
          if (target.includes("/account/roster")) {
            return jsonResponse(roster);
          }
          return jsonResponse({}, false);
        });
        (global as unknown as { fetch: typeof fetch }).fetch =
          fetchImpl as typeof fetch;

        const selectCalls = () =>
          fetchImpl.mock.calls.filter(([url]) =>
            String(url).includes("/account/select")
          );

        const ref = React.createRef<AccountActions>();
        render(
          <EPAccountProvider ref={ref}>
            <span>child</span>
          </EPAccountProvider>
        );
        await flushPromises();
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-a",
          name: "Acme",
        });

        let settled = "pending";
        await act(async () => {
          await ref.current!.selectAccount("acct-b").then(
            () => {
              settled = "resolved";
            },
            () => {
              settled = "rejected";
            }
          );
        });

        expect(settled).toBe("rejected");
        expect(selectCalls()).toHaveLength(1);
        expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
          accountId: "acct-b",
        });
        expect(sessionReadsCount).toBe(2);
        expect(publishedAccount().isLoading).toBe(true);
        expect(publishedAccount().isSelecting).toBe(false);

        await act(async () => {
          await ref.current!.selectAccount("acct-a");
        });

        expect(selectCalls()).toHaveLength(2);
        expect(JSON.parse(String(selectCalls()[1][1]?.body))).toEqual({
          accountId: "acct-a",
        });
        expect(sessionReadsCount).toBe(3);
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-a",
          name: "Acme",
        });
        expect(publishedAccount().isLoading).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not select in the canvas when previewState is auto", async () => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      const { selectCalls, sessionReads } = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
      });
      const ref = React.createRef<AccountActions>();
      const { rerender } = render(
        <EPAccountProvider ref={ref} previewState="auto">
          <span>child</span>
        </EPAccountProvider>
      );

      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });
      const before = publishedAccount();
      const readsBefore = sessionReads().length;

      await act(async () => {
        await ref.current!.selectAccount("acct-b");
      });

      expect(selectCalls()).toEqual([]);
      expect(sessionReads()).toHaveLength(readsBefore);
      expect(publishedAccount()).toEqual(before);
      expect(publishedAccount().isLoading).toBe(false);

      mockUsePlasmicCanvasContext.mockReturnValue(false);
      rerender(
        <EPAccountProvider ref={ref} previewState="auto">
          <span>child</span>
        </EPAccountProvider>
      );
      await act(async () => {
        await ref.current!.selectAccount("acct-b");
      });

      expect(selectCalls()).toHaveLength(1);
      expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
        accountId: "acct-b",
      });
    });

    it("posts select to the ShopperContext basePath", async () => {
      const { selectCalls, sessionReads } = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
      });
      const ref = React.createRef<AccountActions>();
      render(
        <ShopperContext basePath="/api/store">
          <EPAccountProvider ref={ref}>
            <span>child</span>
          </EPAccountProvider>
        </ShopperContext>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });

      await act(async () => {
        await ref.current!.selectAccount("acct-b");
      });

      expect(String(selectCalls()[0][0])).toBe(
        "/api/store/ep/account/select"
      );
      expect(
        sessionReads().every(([url]) => String(url).startsWith("/api/store/"))
      ).toBe(true);
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
    });

    it("issues one selection when the same account is chosen again while that selection is in flight", async () => {
      const { releaseSelect, selectCalls, sessionReads } = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
        holdSelect: true,
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });

      let first = "pending";
      let second = "pending";
      let firstDone: Promise<unknown> = Promise.resolve();
      await act(async () => {
        firstDone = ref.current!.selectAccount("acct-b").then(
          () => {
            first = "resolved";
          },
          () => {
            first = "rejected";
          }
        );
        void ref.current!.selectAccount("acct-b").then(
          () => {
            second = "resolved";
          },
          () => {
            second = "rejected";
          }
        );
      });

      expect(selectCalls()).toHaveLength(1);
      expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
        accountId: "acct-b",
      });
      expect(sessionReads()).toHaveLength(1);
      expect(second).toBe("resolved");
      expect(first).toBe("pending");

      await act(async () => {
        releaseSelect();
        await firstDone;
      });

      expect(first).toBe("resolved");
      expect(selectCalls()).toHaveLength(1);
      expect(sessionReads()).toHaveLength(2);
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
      expect(publishedAccount().isLoading).toBe(false);
    });

    it("keeps the first selection when a different account is chosen while that selection is in flight", async () => {
      const { releaseSelect, releaseReload, selectCalls, sessionReads } =
        installSelectFetch({
          initialSession: { epMemberId: "member-1" },
          nextSession: {
            epMemberId: "member-1",
            epAccount: { id: "acct-b", name: "Northwind" },
          },
          holdSelect: true,
          holdReload: true,
        });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });

      let first = "pending";
      let other = "pending";
      let firstDone: Promise<unknown> = Promise.resolve();
      await act(async () => {
        firstDone = ref.current!.selectAccount("acct-b").then(
          () => {
            first = "resolved";
          },
          () => {
            first = "rejected";
          }
        );
        void ref.current!.selectAccount("acct-a").then(
          () => {
            other = "resolved";
          },
          () => {
            other = "rejected";
          }
        );
      });

      expect(selectCalls()).toHaveLength(1);
      expect(JSON.parse(String(selectCalls()[0][1]?.body))).toEqual({
        accountId: "acct-b",
      });
      expect(sessionReads()).toHaveLength(1);
      expect(other).toBe("resolved");
      expect(first).toBe("pending");

      await act(async () => {
        releaseSelect();
      });
      await waitFor(() => {
        expect(publishedAccount().isLoading).toBe(true);
      });
      expect(sessionReads()).toHaveLength(2);

      let duringReload = "pending";
      await act(async () => {
        void ref.current!.selectAccount("acct-a").then(
          () => {
            duringReload = "resolved";
          },
          () => {
            duringReload = "rejected";
          }
        );
      });

      expect(duringReload).toBe("resolved");
      expect(selectCalls()).toHaveLength(1);
      expect(sessionReads()).toHaveLength(2);
      expect(first).toBe("pending");

      await act(async () => {
        releaseReload();
        await firstDone;
      });

      expect(first).toBe("resolved");
      expect(selectCalls()).toHaveLength(1);
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
      expect(publishedAccount().isLoading).toBe(false);
    });

    it("selects again after the in-flight selection finishes", async () => {
      const session = {
        initialSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-a", name: "Acme" },
        },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
      };
      const { selectCalls } = installSelectFetch(session);
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-a",
          name: "Acme",
        });
      });

      await act(async () => {
        await ref.current!.selectAccount("acct-b");
      });

      expect(selectCalls()).toHaveLength(1);
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });

      session.nextSession = {
        epMemberId: "member-1",
        epAccount: { id: "acct-a", name: "Acme" },
      };
      await act(async () => {
        await ref.current!.selectAccount("acct-a");
      });

      expect(selectCalls()).toHaveLength(2);
      expect(JSON.parse(String(selectCalls()[1][1]?.body))).toEqual({
        accountId: "acct-a",
      });
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-a",
        name: "Acme",
      });
      expect(publishedAccount().isLoading).toBe(false);
    });

    it("selects again after a failed selection releases the in-flight guard", async () => {
      const session = {
        initialSession: { epMemberId: "member-1" },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
        selectOk: false,
        selectCode: "account_not_found",
      };
      const { selectCalls, sessionReads } = installSelectFetch(session);
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });
      const before = publishedAccount();

      let settled = "pending";
      await act(async () => {
        await ref.current!.selectAccount("acct-b").then(
          () => {
            settled = "resolved";
          },
          () => {
            settled = "rejected";
          }
        );
      });

      expect(settled).toBe("rejected");
      expect(selectCalls()).toHaveLength(1);
      expect(sessionReads()).toHaveLength(1);
      expect(publishedAccount()).toEqual(before);
      expect(publishedAccount().isLoading).toBe(false);

      session.selectOk = true;
      await act(async () => {
        await ref.current!.selectAccount("acct-b");
      });

      expect(selectCalls()).toHaveLength(2);
      expect(JSON.parse(String(selectCalls()[1][1]?.body))).toEqual({
        accountId: "acct-b",
      });
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
      expect(publishedAccount().isLoading).toBe(false);
    });

    it("publishes isSelecting through a real selection and its reload", async () => {
      const { releaseSelect, releaseReload, selectCalls } = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
        nextSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-b", name: "Northwind" },
        },
        holdSelect: true,
        holdReload: true,
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <EPAccountGate when="authenticated">
            <span data-testid="signed-in">Signed in</span>
          </EPAccountGate>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });
      expect(publishedAccount().isSelecting).toBe(false);
      const roster = publishedAccount().accountRoster;

      let first = "pending";
      let ignored = "pending";
      let firstDone: Promise<unknown> = Promise.resolve();
      await act(async () => {
        firstDone = ref.current!.selectAccount("acct-b").then(
          () => {
            first = "resolved";
          },
          () => {
            first = "rejected";
          }
        );
        void ref.current!.selectAccount("acct-a").then(
          () => {
            ignored = "resolved";
          },
          () => {
            ignored = "rejected";
          }
        );
      });

      expect(selectCalls()).toHaveLength(1);
      expect(ignored).toBe("resolved");
      expect(first).toBe("pending");
      expect(publishedAccount().isSelecting).toBe(true);
      expect(publishedAccount().isLoading).toBe(false);
      expect(publishedAccount().state).toBe("memberOnly");
      expect(publishedAccount().accountRoster).toEqual(roster);
      expect(screen.getByTestId("signed-in")).toBeTruthy();

      await act(async () => {
        releaseSelect();
      });
      await waitFor(() => {
        expect(publishedAccount().isLoading).toBe(true);
      });
      expect(publishedAccount().isSelecting).toBe(true);
      expect(first).toBe("pending");
      expect(selectCalls()).toHaveLength(1);
      expect(screen.queryByTestId("signed-in")).toBeNull();

      await act(async () => {
        releaseReload();
        await firstDone;
      });

      expect(first).toBe("resolved");
      expect(publishedAccount().isSelecting).toBe(false);
      expect(publishedAccount().isLoading).toBe(false);
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-b",
        name: "Northwind",
      });
      expect(screen.getByTestId("signed-in")).toBeTruthy();
    });

    it("does not set isSelecting for a canvas no-op or the already-selected id", async () => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      const canvas = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
      });
      const canvasRef = React.createRef<AccountActions>();
      const { rerender, unmount } = render(
        <EPAccountProvider ref={canvasRef} previewState="auto">
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });
      const canvasBefore = publishedAccount();

      await act(async () => {
        await canvasRef.current!.selectAccount("acct-b");
      });

      expect(canvas.selectCalls()).toEqual([]);
      expect(publishedAccount()).toEqual(canvasBefore);
      expect(publishedAccount().isSelecting).toBe(false);

      mockUsePlasmicCanvasContext.mockReturnValue(false);
      rerender(
        <EPAccountProvider ref={canvasRef} previewState="auto">
          <span>child</span>
        </EPAccountProvider>
      );
      await act(async () => {
        await canvasRef.current!.selectAccount("acct-b");
      });
      expect(canvas.selectCalls()).toHaveLength(1);
      unmount();

      const selected = installSelectFetch({
        initialSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-a", name: "Acme" },
        },
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <span>child</span>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().selectedAccount).toEqual({
          id: "acct-a",
          name: "Acme",
        });
      });
      const before = publishedAccount();

      await act(async () => {
        await ref.current!.selectAccount("acct-a");
      });

      expect(selected.selectCalls()).toEqual([]);
      expect(publishedAccount()).toEqual(before);
      expect(publishedAccount().isSelecting).toBe(false);
    });

    it("clears isSelecting when selection fails and leaves the published account", async () => {
      const { releaseSelect, selectCalls, sessionReads } = installSelectFetch({
        initialSession: { epMemberId: "member-1" },
        selectOk: false,
        selectCode: "account_not_found",
        holdSelect: true,
      });
      const ref = React.createRef<AccountActions>();
      render(
        <EPAccountProvider ref={ref}>
          <EPAccountGate when="authenticated">
            <span data-testid="signed-in">Signed in</span>
          </EPAccountGate>
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().state).toBe("memberOnly");
      });
      const before = publishedAccount();

      let settled = "pending";
      let pending: Promise<unknown> = Promise.resolve();
      await act(async () => {
        pending = ref.current!.selectAccount("acct-missing").then(
          () => {
            settled = "resolved";
          },
          () => {
            settled = "rejected";
          }
        );
      });

      expect(selectCalls()).toHaveLength(1);
      expect(publishedAccount().isSelecting).toBe(true);
      expect(publishedAccount().isLoading).toBe(false);
      expect(publishedAccount().state).toBe("memberOnly");
      expect(screen.getByTestId("signed-in")).toBeTruthy();
      expect(settled).toBe("pending");

      await act(async () => {
        releaseSelect();
        await pending;
      });

      expect(settled).toBe("rejected");
      expect(sessionReads()).toHaveLength(1);
      expect(publishedAccount()).toEqual(before);
      expect(publishedAccount().isSelecting).toBe(false);
      expect(publishedAccount().isLoading).toBe(false);
      expect(screen.getByTestId("signed-in")).toBeTruthy();
    });
  });

  describe("latest read", () => {
    it("does not let a late initial read overwrite a newer reload", async () => {
      let releaseInitial: () => void = () => {};
      let releaseReload: () => void = () => {};
      const initialGate = new Promise<void>((resolve) => {
        releaseInitial = resolve;
      });
      const reloadGate = new Promise<void>((resolve) => {
        releaseReload = resolve;
      });
      let sessionReads = 0;
      (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(
        (url: string) => {
          if (String(url).endsWith("/get-session")) {
            sessionReads += 1;
            const gate = sessionReads === 1 ? initialGate : reloadGate;
            const memberId =
              sessionReads === 1 ? "stale-initial" : "from-reload";
            return gate.then(() =>
              jsonResponse({ session: { epMemberId: memberId } })
            );
          }
          if (String(url).includes("/account/roster")) {
            return jsonResponse({ accounts: [], total: 0 });
          }
          return jsonResponse({}, false);
        }
      ) as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      render(
        <EPAccountProvider>
          <ReloadHandle handle={handle} />
        </EPAccountProvider>
      );
      await waitFor(() => expect(sessionReads).toBe(1));

      let reloadDone: Promise<void> = Promise.resolve();
      await act(async () => {
        reloadDone = handle.reload!();
      });
      expect(sessionReads).toBe(2);

      await act(async () => {
        releaseInitial();
      });
      expect(publishedAccount().isLoading).toBe(true);

      await act(async () => {
        releaseReload();
        await reloadDone;
      });
      expect(publishedAccount().accountMember).toEqual({ id: "from-reload" });
      expect(publishedAccount().isLoading).toBe(false);
    });

    it("does not let an older reload overwrite a newer one", async () => {
      const releases: Array<() => void> = [];
      let sessionReads = 0;
      (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(
        (url: string) => {
          if (String(url).endsWith("/get-session")) {
            sessionReads += 1;
            if (sessionReads === 1) {
              return jsonResponse({ session: { epMemberId: "initial" } });
            }
            let release: () => void = () => {};
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            releases.push(release);
            const memberId =
              sessionReads === 2 ? "from-first-reload" : "from-second-reload";
            return gate.then(() =>
              jsonResponse({ session: { epMemberId: memberId } })
            );
          }
          if (String(url).includes("/account/roster")) {
            return jsonResponse({ accounts: [], total: 0 });
          }
          return jsonResponse({}, false);
        }
      ) as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      render(
        <EPAccountProvider>
          <ReloadHandle handle={handle} />
        </EPAccountProvider>
      );
      await waitFor(() => {
        expect(publishedAccount().accountMember).toEqual({ id: "initial" });
      });

      let first: Promise<void> = Promise.resolve();
      let second: Promise<void> = Promise.resolve();
      await act(async () => {
        first = handle.reload!();
      });
      await act(async () => {
        second = handle.reload!();
      });
      await act(async () => {
        releases[0]();
        await first;
      });
      expect(publishedAccount().isLoading).toBe(true);

      await act(async () => {
        releases[1]();
        await second;
      });
      expect(publishedAccount().accountMember).toEqual({
        id: "from-second-reload",
      });
    });

    it("does not publish an in-flight reload onto a later basePath", async () => {
      let releaseStale: () => void = () => {};
      const staleGate = new Promise<void>((resolve) => {
        releaseStale = resolve;
      });
      let readsOnA = 0;
      (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(
        (url: string) => {
          const target = String(url);
          if (target.startsWith("/api/a/") && target.endsWith("/get-session")) {
            readsOnA += 1;
            if (readsOnA === 1) {
              return jsonResponse({ session: { epMemberId: "member-a" } });
            }
            return staleGate.then(() =>
              jsonResponse({ session: { epMemberId: "stale-a" } })
            );
          }
          if (target.startsWith("/api/b/") && target.endsWith("/get-session")) {
            return jsonResponse({ session: { epMemberId: "member-b" } });
          }
          if (target.includes("/account/roster")) {
            return jsonResponse({ accounts: [], total: 0 });
          }
          return jsonResponse({}, false);
        }
      ) as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      const tree = (basePath: string) => (
        <ShopperContext basePath={basePath}>
          <EPAccountProvider>
            <ReloadHandle handle={handle} />
          </EPAccountProvider>
        </ShopperContext>
      );
      const { rerender } = render(tree("/api/a"));
      await waitFor(() => {
        expect(publishedAccount().accountMember).toEqual({ id: "member-a" });
      });

      let stale: Promise<void> = Promise.resolve();
      await act(async () => {
        stale = handle.reload!();
      });
      rerender(tree("/api/b"));
      await waitFor(() => {
        expect(publishedAccount().accountMember).toEqual({ id: "member-b" });
      });

      await act(async () => {
        releaseStale();
        await stale;
      });
      expect(publishedAccount().accountMember).toEqual({ id: "member-b" });
    });
  });

  describe("reload retry", () => {
    const backoff = RELOAD_RETRY_BACKOFF_MS as readonly number[];

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    async function flushPromises() {
      await act(async () => {
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });
    }

    async function advance(ms: number) {
      await act(async () => {
        jest.advanceTimersByTime(ms);
      });
      await flushPromises();
    }

    function sessionReads(fetchImpl: jest.Mock, prefix = ""): string[] {
      return fetchImpl.mock.calls
        .map(([url]) => String(url))
        .filter(
          (url) => url.endsWith("/get-session") && url.startsWith(prefix)
        );
    }

    it("rejects the reload, keeps Gates closed, and publishes the automatic retry", async () => {
      let sessionReadsCount = 0;
      const fetchImpl = jest.fn((url: string) => {
        const target = String(url);
        if (target.endsWith("/get-session")) {
          sessionReadsCount += 1;
          if (sessionReadsCount === 1) {
            return jsonResponse({ session: { epMemberId: "member-1" } });
          }
          if (sessionReadsCount === 2) {
            return jsonResponse({ message: "unavailable" }, false);
          }
          return jsonResponse({
            session: { epMemberId: "member-recovered" },
          });
        }
        if (target.includes("/account/roster")) {
          return jsonResponse({ accounts: [], total: 0 });
        }
        return jsonResponse({}, false);
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      render(
        <EPAccountProvider>
          <ReloadHandle handle={handle} />
          <EPAccountGate when="anonymous">
            <span data-testid="signed-out">Signed out</span>
          </EPAccountGate>
          <EPAccountGate when="authenticated">
            <span data-testid="signed-in">Signed in</span>
          </EPAccountGate>
        </EPAccountProvider>
      );
      await flushPromises();
      expect(screen.getByTestId("signed-in")).toBeTruthy();

      let settled = "pending";
      let reloadPromise: Promise<void> = Promise.resolve();
      await act(async () => {
        reloadPromise = handle.reload!().then(
          () => {
            settled = "resolved";
          },
          () => {
            settled = "rejected";
          }
        );
      });
      await flushPromises();
      await act(async () => {
        await reloadPromise;
      });

      expect(settled).toBe("rejected");
      expect(sessionReadsCount).toBe(2);
      expect(publishedAccount().isLoading).toBe(true);
      expect(screen.queryByTestId("signed-in")).toBeNull();
      expect(screen.queryByTestId("signed-out")).toBeNull();

      await advance(backoff[0] - 1);
      expect(sessionReadsCount).toBe(2);
      expect(publishedAccount().isLoading).toBe(true);

      await advance(1);
      expect(sessionReadsCount).toBe(3);
      expect(publishedAccount().accountMember).toEqual({
        id: "member-recovered",
      });
      expect(publishedAccount().isLoading).toBe(false);
      expect(screen.getByTestId("signed-in")).toBeTruthy();
      expect(handle.reload).toBeTruthy();
    });

    it("does not let an older retry overwrite a newer reload", async () => {
      let sessionReadsCount = 0;
      let releaseNewer: () => void = () => {};
      const newerGate = new Promise<void>((resolve) => {
        releaseNewer = resolve;
      });
      const fetchImpl = jest.fn((url: string) => {
        const target = String(url);
        if (target.endsWith("/get-session")) {
          sessionReadsCount += 1;
          if (sessionReadsCount === 1) {
            return jsonResponse({ session: { epMemberId: "initial" } });
          }
          if (sessionReadsCount === 2) {
            return jsonResponse({ message: "unavailable" }, false);
          }
          const memberId =
            sessionReadsCount === 3 ? "from-newer" : "from-stale-retry";
          return newerGate.then(() =>
            jsonResponse({ session: { epMemberId: memberId } })
          );
        }
        if (target.includes("/account/roster")) {
          return jsonResponse({ accounts: [], total: 0 });
        }
        return jsonResponse({}, false);
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      render(
        <EPAccountProvider>
          <ReloadHandle handle={handle} />
        </EPAccountProvider>
      );
      await flushPromises();
      expect(publishedAccount().accountMember).toEqual({ id: "initial" });

      let first: Promise<void> = Promise.resolve();
      await act(async () => {
        first = handle.reload!().then(
          () => undefined,
          () => undefined
        );
      });
      await flushPromises();
      await act(async () => {
        await first;
      });
      expect(sessionReadsCount).toBe(2);
      expect(publishedAccount().isLoading).toBe(true);

      let second: Promise<void> = Promise.resolve();
      await act(async () => {
        second = handle.reload!();
      });
      expect(sessionReadsCount).toBe(3);

      await advance(backoff.reduce((sum, delay) => sum + delay, 0) + 1000);
      expect(sessionReadsCount).toBe(3);
      expect(publishedAccount().isLoading).toBe(true);

      await act(async () => {
        releaseNewer();
        await second;
      });
      expect(publishedAccount().accountMember).toEqual({ id: "from-newer" });
      expect(publishedAccount().isLoading).toBe(false);
    });

    it("cancels a pending retry when the identity client changes", async () => {
      let readsOnA = 0;
      const fetchImpl = jest.fn((url: string) => {
        const target = String(url);
        if (target.startsWith("/api/a/") && target.endsWith("/get-session")) {
          readsOnA += 1;
          if (readsOnA === 1) {
            return jsonResponse({ session: { epMemberId: "member-a" } });
          }
          return jsonResponse({ message: "unavailable" }, false);
        }
        if (target.startsWith("/api/b/") && target.endsWith("/get-session")) {
          return jsonResponse({ session: { epMemberId: "member-b" } });
        }
        if (target.includes("/account/roster")) {
          return jsonResponse({ accounts: [], total: 0 });
        }
        return jsonResponse({}, false);
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      const tree = (basePath: string) => (
        <ShopperContext basePath={basePath}>
          <EPAccountProvider>
            <ReloadHandle handle={handle} />
          </EPAccountProvider>
        </ShopperContext>
      );
      const { rerender } = render(tree("/api/a"));
      await flushPromises();
      expect(publishedAccount().accountMember).toEqual({ id: "member-a" });

      let failed: Promise<void> = Promise.resolve();
      await act(async () => {
        failed = handle.reload!().then(
          () => undefined,
          () => undefined
        );
      });
      await flushPromises();
      await act(async () => {
        await failed;
      });
      expect(readsOnA).toBe(2);

      rerender(tree("/api/b"));
      await flushPromises();
      expect(publishedAccount().accountMember).toEqual({ id: "member-b" });

      await advance(backoff[backoff.length - 1] * 4);
      expect(readsOnA).toBe(2);
      expect(sessionReads(fetchImpl, "/api/a/")).toHaveLength(2);
      expect(publishedAccount().accountMember).toEqual({ id: "member-b" });
    });

    it("cancels a pending retry when the provider unmounts", async () => {
      let sessionReadsCount = 0;
      const fetchImpl = jest.fn((url: string) => {
        if (String(url).endsWith("/get-session")) {
          sessionReadsCount += 1;
          if (sessionReadsCount === 1) {
            return jsonResponse({ session: { epMemberId: "member-1" } });
          }
          return jsonResponse({ message: "unavailable" }, false);
        }
        return jsonResponse({ accounts: [], total: 0 });
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      const { unmount } = render(
        <EPAccountProvider>
          <ReloadHandle handle={handle} />
        </EPAccountProvider>
      );
      await flushPromises();

      let failed: Promise<void> = Promise.resolve();
      await act(async () => {
        failed = handle.reload!().then(
          () => undefined,
          () => undefined
        );
      });
      await flushPromises();
      await act(async () => {
        await failed;
      });
      expect(sessionReadsCount).toBe(2);

      unmount();
      await advance(backoff[backoff.length - 1] * 4);
      expect(sessionReadsCount).toBe(2);
    });

    it("spaces repeated failures so requests do not overlap", async () => {
      let sessionReadsCount = 0;
      let releaseHeld: ((fail: boolean) => void) | null = null;
      const fetchImpl = jest.fn((url: string) => {
        const target = String(url);
        if (target.endsWith("/get-session")) {
          sessionReadsCount += 1;
          if (sessionReadsCount === 1) {
            return jsonResponse({ session: { epMemberId: "member-1" } });
          }
          if (sessionReadsCount === 2) {
            return jsonResponse({ message: "unavailable" }, false);
          }
          return new Promise((resolve) => {
            releaseHeld = (fail: boolean) => {
              resolve(
                fail
                  ? {
                      ok: false,
                      json: () => Promise.resolve({ message: "unavailable" }),
                    }
                  : {
                      ok: true,
                      json: () =>
                        Promise.resolve({
                          session: { epMemberId: "member-recovered" },
                        }),
                    }
              );
            };
          });
        }
        if (target.includes("/account/roster")) {
          return jsonResponse({ accounts: [], total: 0 });
        }
        return jsonResponse({}, false);
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      render(
        <EPAccountProvider>
          <ReloadHandle handle={handle} />
          <EPAccountGate when="authenticated">
            <span data-testid="signed-in">Signed in</span>
          </EPAccountGate>
        </EPAccountProvider>
      );
      await flushPromises();

      let failed: Promise<void> = Promise.resolve();
      await act(async () => {
        failed = handle.reload!().then(
          () => undefined,
          () => undefined
        );
      });
      await flushPromises();
      await act(async () => {
        await failed;
      });
      expect(sessionReadsCount).toBe(2);
      expect(publishedAccount().isLoading).toBe(true);

      await advance(backoff[0] - 1);
      expect(sessionReadsCount).toBe(2);

      await advance(1);
      expect(sessionReadsCount).toBe(3);
      expect(releaseHeld).toBeTruthy();
      const releaseFirstRetry = releaseHeld!;
      releaseHeld = null;

      await advance(backoff[backoff.length - 1] * 4);
      expect(sessionReadsCount).toBe(3);

      await act(async () => {
        releaseFirstRetry(true);
      });
      await flushPromises();
      expect(sessionReadsCount).toBe(3);
      expect(publishedAccount().isLoading).toBe(true);

      await advance(backoff[1] - 1);
      expect(sessionReadsCount).toBe(3);

      await advance(1);
      expect(sessionReadsCount).toBe(4);
      expect(releaseHeld).toBeTruthy();
      const releaseSecondRetry = releaseHeld!;

      await advance(backoff[backoff.length - 1] * 4);
      expect(sessionReadsCount).toBe(4);

      await act(async () => {
        releaseSecondRetry(false);
      });
      await flushPromises();
      expect(publishedAccount().accountMember).toEqual({
        id: "member-recovered",
      });
      expect(publishedAccount().isLoading).toBe(false);
      expect(screen.getByTestId("signed-in")).toBeTruthy();
    });

    it("keeps retries after the listed delays at 30s", async () => {
      expect([...backoff]).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
      let sessionReadsCount = 0;
      let releaseHeld: ((fail: boolean) => void) | null = null;
      (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(
        (url: string) => {
          const target = String(url);
          if (target.endsWith("/get-session")) {
            sessionReadsCount += 1;
            if (sessionReadsCount === 1) {
              return jsonResponse({ session: { epMemberId: "member-1" } });
            }
            if (sessionReadsCount === 2) {
              return jsonResponse({ message: "unavailable" }, false);
            }
            return new Promise((resolve) => {
              releaseHeld = (fail: boolean) => {
                resolve({
                  ok: !fail,
                  json: () =>
                    Promise.resolve(
                      fail
                        ? { message: "unavailable" }
                        : { session: { epMemberId: "member-1" } }
                    ),
                });
              };
            });
          }
          if (target.includes("/account/roster")) {
            return jsonResponse({ accounts: [], total: 0 });
          }
          return jsonResponse({}, false);
        }
      ) as typeof fetch;
      const handle: { reload?: () => Promise<void> } = {};
      render(
        <EPAccountProvider>
          <ReloadHandle handle={handle} />
        </EPAccountProvider>
      );
      await flushPromises();

      let failed: Promise<void> = Promise.resolve();
      await act(async () => {
        failed = handle.reload!().then(
          () => undefined,
          () => undefined
        );
      });
      await flushPromises();
      await act(async () => {
        await failed;
      });
      expect(sessionReadsCount).toBe(2);

      for (const delay of backoff) {
        const before = sessionReadsCount;
        await advance(delay - 1);
        expect(sessionReadsCount).toBe(before);
        await advance(1);
        expect(sessionReadsCount).toBe(before + 1);
        const release = releaseHeld!;
        releaseHeld = null;
        await act(async () => {
          release(true);
        });
        await flushPromises();
        expect(sessionReadsCount).toBe(before + 1);
      }

      const beforeCap = sessionReadsCount;
      await advance(backoff[backoff.length - 1] - 1);
      expect(sessionReadsCount).toBe(beforeCap);
      await advance(1);
      expect(sessionReadsCount).toBe(beforeCap + 1);
    });
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
    it("has the Accounts provider meta shape and logout and selectAccount refActions", () => {
      expect(epAccountProviderMeta.name).toBe(
        "plasmic-commerce-ep-account-provider"
      );
      expect(epAccountProviderMeta.displayName).toBe("EP Account Provider");
      expect(epAccountProviderMeta.providesData).toBe(true);
      expect(epAccountProviderMeta.importName).toBe("EPAccountProvider");
      expect(epAccountProviderMeta.refActions?.logout).toEqual(
        expect.objectContaining({ argTypes: [] })
      );
      expect(epAccountProviderMeta.refActions?.selectAccount).toEqual(
        expect.objectContaining({
          argTypes: [{ name: "accountId", type: "string", displayName: "Account ID" }],
        })
      );
      expect(
        Object.keys(epAccountProviderMeta.refActions ?? {})
      ).toEqual(["logout", "selectAccount"]);
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
