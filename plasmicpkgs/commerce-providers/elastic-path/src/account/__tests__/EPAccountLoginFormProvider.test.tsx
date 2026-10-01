/**
 * @jest-environment jsdom
 *
 * EPAccountLoginFormProvider — signs in through useEpIdentity and asks the
 * Account Provider to reload. Credentials stay off the Studio data.
 */

const mockUsePlasmicCanvasContext = jest.fn().mockReturnValue(false);
jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  return {
    DataProvider: ({ children, name, data }: any) =>
      React.createElement(
        "div",
        {
          "data-testid": `data-provider-${name}`,
          "data-value": JSON.stringify(data),
        },
        children
      ),
    useSelector: jest.fn().mockReturnValue(undefined),
    usePlasmicCanvasContext: (...args: any[]) =>
      mockUsePlasmicCanvasContext(...args),
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React, { useEffect, useRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShopperContext } from "../../shopper-context/ShopperContext";

const { EPAccountProvider } = require("../EPAccountProvider");
const { useAccountReload } = require("../EPAccountProvider");
const {
  EPAccountLoginFormProvider,
  useAccountLoginForm,
  epAccountLoginFormProviderMeta,
  registerEPAccountLoginFormProvider,
} = require("../EPAccountLoginFormProvider");

interface LoginActions {
  submit(): Promise<void>;
}

function publishedForm() {
  const node = screen.getByTestId("data-provider-accountLoginFormData");
  return JSON.parse(node.getAttribute("data-value")!);
}

function publishedAccount() {
  return JSON.parse(
    screen.getByTestId("data-provider-account").getAttribute("data-value")!
  );
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 401,
    json: () => Promise.resolve(body),
  });
}

function RegisterRequired() {
  const form = useAccountLoginForm();
  useEffect(() => {
    form.registerField("username", { required: true });
    form.registerField("password", { required: true });
    return () => {
      form.unregisterField("username");
      form.unregisterField("password");
    };
  }, [form]);
  return null;
}

function Fill(props: { username?: string; password?: string }) {
  const form = useAccountLoginForm();
  return (
    <button
      type="button"
      data-testid="fill"
      onClick={() => {
        form.setField("username", props.username ?? "buyer@example.com");
        form.setField("password", props.password ?? "secret");
      }}
    >
      fill
    </button>
  );
}

function installFetch(options?: {
  hangLogin?: boolean;
  hangReload?: boolean;
  loginFails?: boolean;
  reloadSessionFails?: boolean;
  /** Session `get-session` returns after the first, anonymous read. */
  postLoginSession?: Record<string, unknown>;
  roster?: { accounts: unknown[]; total: number };
}) {
  let getSessionCount = 0;
  let releaseLogin: () => void = () => {};
  let releaseReload: () => void = () => {};
  const loginGate = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  const reloadGate = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/get-session")) {
      getSessionCount += 1;
      if (options?.reloadSessionFails && getSessionCount > 1) {
        return jsonResponse({ message: "Invalid credentials" }, false);
      }
      if (options?.hangReload && getSessionCount > 1) {
        return reloadGate.then(() =>
          jsonResponse({
            session: options.postLoginSession ?? { epMemberId: "member-1" },
          })
        );
      }
      if (options?.postLoginSession && getSessionCount > 1) {
        return jsonResponse({ session: options.postLoginSession });
      }
      return jsonResponse({ session: {} });
    }
    if (target.includes("/account/login")) {
      if (options?.loginFails) {
        return jsonResponse({ message: "Invalid credentials" }, false);
      }
      const response = jsonResponse({
        user: { id: "user-1", email: "buyer@example.com" },
        session: { epMemberId: "member-1" },
        accounts: [],
        total: 0,
      });
      return options?.hangLogin ? loginGate.then(() => response) : response;
    }
    if (target.includes("/account/roster")) {
      return jsonResponse(options?.roster ?? { accounts: [], total: 0 });
    }
    return jsonResponse({}, false);
  });
  (global as unknown as { fetch: typeof fetch }).fetch =
    fetchImpl as typeof fetch;
  return { fetchImpl, releaseLogin, releaseReload };
}

function loginCalls(fetchImpl: jest.Mock) {
  return fetchImpl.mock.calls.filter(([url]) =>
    String(url).includes("/account/login")
  );
}

describe("EPAccountLoginFormProvider", () => {
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

  function renderForm(basePath?: string) {
    const ref = React.createRef<LoginActions>();
    const tree = (
      <EPAccountProvider>
        <EPAccountLoginFormProvider ref={ref}>
          <Fill />
        </EPAccountLoginFormProvider>
      </EPAccountProvider>
    );
    render(
      basePath ? (
        <ShopperContext basePath={basePath}>{tree}</ShopperContext>
      ) : (
        tree
      )
    );
    return ref;
  }

  it("signs in with username and password, then waits for the account reload", async () => {
    const { fetchImpl, releaseReload } = installFetch({ hangReload: true });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));

    let submit: Promise<void> = Promise.resolve();
    await act(async () => {
      submit = ref.current!.submit();
    });

    expect(loginCalls(fetchImpl)).toHaveLength(1);
    expect(JSON.parse(String(loginCalls(fetchImpl)[0][1]?.body))).toEqual({
      username: "buyer@example.com",
      password: "secret",
    });
    expect(String(loginCalls(fetchImpl)[0][0])).toBe(
      "/api/ep/ep/account/login"
    );
    expect(publishedForm().isSubmitting).toBe(true);
    expect(
      fetchImpl.mock.calls.filter(([url]) =>
        String(url).endsWith("/get-session")
      )
    ).toHaveLength(2);

    await act(async () => {
      releaseReload();
      await submit;
    });
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
    await waitFor(() => {
      const account = JSON.parse(
        screen.getByTestId("data-provider-account").getAttribute("data-value")!
      );
      expect(account.accountMember).toEqual({ id: "member-1" });
      expect(account.isLoading).toBe(false);
    });
  });

  describe("login round trip", () => {
    async function signIn(options: {
      postLoginSession: Record<string, unknown>;
      roster: { accounts: unknown[]; total: number };
    }) {
      const installed = installFetch(options);
      const ref = renderForm();
      await waitFor(() => {
        expect(publishedAccount()).toEqual(
          expect.objectContaining({ state: "anonymous", isLoading: false })
        );
      });
      fireEvent.click(screen.getByTestId("fill"));
      await act(async () => {
        await ref.current!.submit();
      });
      expect(loginCalls(installed.fetchImpl)).toHaveLength(1);
      expect(publishedForm()).toEqual({
        status: "submitted",
        error: null,
        isSubmitting: false,
      });
      return installed;
    }

    it("publishes selected when the reloaded session has one account", async () => {
      await signIn({
        postLoginSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-1", name: "Acme", token: "secret" },
        },
        roster: {
          accounts: [{ id: "acct-1", name: "Acme" }],
          total: 1,
        },
      });

      expect(publishedAccount()).toEqual({
        state: "selected",
        accountMember: { id: "member-1" },
        selectedAccount: { id: "acct-1", name: "Acme" },
        accountRoster: {
          accounts: [{ id: "acct-1", name: "Acme" }],
          total: 1,
        },
        lapsedAccount: null,
        isLoading: false,
        isSelecting: false,
      });
    });

    it("publishes memberOnly with the roster when several accounts are unselected", async () => {
      await signIn({
        postLoginSession: { epMemberId: "member-1" },
        roster: {
          accounts: [
            { id: "acct-1", name: "Acme" },
            { id: "acct-2", name: "Beta" },
          ],
          total: 2,
        },
      });

      expect(publishedAccount()).toEqual({
        state: "memberOnly",
        accountMember: { id: "member-1" },
        selectedAccount: null,
        accountRoster: {
          accounts: [
            { id: "acct-1", name: "Acme" },
            { id: "acct-2", name: "Beta" },
          ],
          total: 2,
        },
        lapsedAccount: null,
        isLoading: false,
        isSelecting: false,
      });
    });

    it("publishes memberOnly when login leaves the member with no accounts", async () => {
      await signIn({
        postLoginSession: { epMemberId: "member-1" },
        roster: { accounts: [], total: 0 },
      });

      expect(publishedAccount()).toEqual({
        state: "memberOnly",
        accountMember: { id: "member-1" },
        selectedAccount: null,
        accountRoster: { accounts: [], total: 0 },
        lapsedAccount: null,
        isLoading: false,
        isSelecting: false,
      });
    });
  });

  it("issues one login when submit is repeated while in flight", async () => {
    const { fetchImpl, releaseLogin } = installFetch({ hangLogin: true });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = ref.current!.submit();
      void ref.current!.submit();
    });
    expect(loginCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm().isSubmitting).toBe(true);

    await act(async () => {
      releaseLogin();
    });
    await act(async () => {
      await first;
    });
    expect(loginCalls(fetchImpl)).toHaveLength(1);
  });

  it("does not call login in the canvas", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { fetchImpl } = installFetch();
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(loginCalls(fetchImpl)).toEqual([]);
    expect(publishedForm().isSubmitting).toBe(false);
  });

  it("does not call login when a required value is missing", async () => {
    const { fetchImpl } = installFetch();
    const ref = React.createRef<LoginActions>();
    render(
      <EPAccountProvider>
        <EPAccountLoginFormProvider ref={ref}>
          <RegisterRequired />
        </EPAccountLoginFormProvider>
      </EPAccountProvider>
    );
    await act(async () => {
      await ref.current!.submit();
    });
    expect(loginCalls(fetchImpl)).toEqual([]);
    expect(publishedForm().status).toBe("error");
    expect(publishedForm().error).toBe("Please complete the required fields.");
    expect(publishedForm().isSubmitting).toBe(false);
  });

  it("publishes an identity failure as a form error and does not reload", async () => {
    const { fetchImpl } = installFetch({ loginFails: true });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(publishedForm()).toEqual({
      status: "error",
      error: "Invalid credentials",
      isSubmitting: false,
    });
    expect(
      fetchImpl.mock.calls.filter(([url]) =>
        String(url).endsWith("/get-session")
      )
    ).toHaveLength(1);
  });

  it("does not report a failed account refresh as an authentication error", async () => {
    installFetch({ reloadSessionFails: true });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: "Signed in, but the account could not be refreshed.",
      isSubmitting: false,
    });
    const account = JSON.parse(
      screen.getByTestId("data-provider-account").getAttribute("data-value")!
    );
    expect(account.isLoading).toBe(true);
    expect(account.accountMember).toBeNull();
  });

  it("keeps credentials out of the Studio data", async () => {
    installFetch();
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    const raw = screen
      .getByTestId("data-provider-accountLoginFormData")
      .getAttribute("data-value")!;
    expect(raw).not.toMatch(/buyer@example.com/);
    expect(raw).not.toMatch(/secret/);
    expect(JSON.parse(raw)).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
  });

  it("posts login through the ShopperContext basePath", async () => {
    const { fetchImpl } = installFetch();
    const ref = renderForm("/api/store");
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(String(loginCalls(fetchImpl)[0][0])).toBe(
      "/api/store/ep/account/login"
    );
    expect(
      fetchImpl.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.endsWith("/get-session"))
        .every((url) => url.startsWith("/api/store/"))
    ).toBe(true);
  });

  it("no-ops the reload hook outside the Account Provider", async () => {
    const fetchImpl = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch =
      fetchImpl as typeof fetch;
    function Probe() {
      const reload = useAccountReload();
      const once = useRef(false);
      useEffect(() => {
        if (once.current) return;
        once.current = true;
        void reload();
      }, [reload]);
      return null;
    }
    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("registers a submit ref action and no credential props", () => {
    expect(epAccountLoginFormProviderMeta.name).toBe(
      "plasmic-commerce-ep-account-login-form-provider"
    );
    expect(epAccountLoginFormProviderMeta.importName).toBe(
      "EPAccountLoginFormProvider"
    );
    expect(epAccountLoginFormProviderMeta.importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path"
    );
    expect(epAccountLoginFormProviderMeta.refActions?.submit).toEqual(
      expect.objectContaining({ argTypes: [] })
    );
    expect(epAccountLoginFormProviderMeta.props).not.toHaveProperty("username");
    expect(epAccountLoginFormProviderMeta.props).not.toHaveProperty("password");
    const loader = { registerComponent: jest.fn() };
    registerEPAccountLoginFormProvider(loader);
    expect(loader.registerComponent).toHaveBeenCalledWith(
      EPAccountLoginFormProvider,
      epAccountLoginFormProviderMeta
    );
  });
});
