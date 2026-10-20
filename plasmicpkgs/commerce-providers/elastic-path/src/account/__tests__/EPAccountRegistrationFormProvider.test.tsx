/**
 * @jest-environment jsdom
 *
 * EPAccountRegistrationFormProvider — registers through useEpIdentity and
 * asks the Account Provider to reload. Credentials stay off the Studio data.
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

import React, { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  EPAccountProvider,
  RELOAD_RETRY_BACKOFF_MS,
} = require("../EPAccountProvider");
const {
  EPAccountRegistrationFormProvider,
  useAccountRegistrationForm,
  epAccountRegistrationFormProviderMeta,
  registerEPAccountRegistrationFormProvider,
} = require("../EPAccountRegistrationFormProvider");

type RegistrationField =
  | "name"
  | "email"
  | "username"
  | "password"
  | "confirmPassword";

interface RegistrationActions {
  submit(): Promise<void>;
}

interface FillValues {
  name?: string;
  email?: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
}

function publishedForm() {
  const node = screen.getByTestId("data-provider-accountRegistrationFormData");
  return JSON.parse(node.getAttribute("data-value")!);
}

function publishedAccount() {
  return JSON.parse(
    screen.getByTestId("data-provider-account").getAttribute("data-value")!
  );
}

function fieldErrors() {
  return JSON.parse(screen.getByTestId("field-errors").textContent!);
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

function RegisterFields(props: { names: RegistrationField[] }) {
  const form = useAccountRegistrationForm();
  useEffect(() => {
    props.names.forEach((name) => form.registerField(name));
    return () => props.names.forEach((name) => form.unregisterField(name));
  }, [form, props.names]);
  return null;
}

function Fill(props: FillValues) {
  const form = useAccountRegistrationForm();
  return (
    <button
      type="button"
      data-testid="fill"
      onClick={() => {
        if (props.name !== undefined) form.setField("name", props.name);
        if (props.email !== undefined) form.setField("email", props.email);
        if (props.username !== undefined) {
          form.setField("username", props.username);
        }
        if (props.password !== undefined) {
          form.setField("password", props.password);
        }
        if (props.confirmPassword !== undefined) {
          form.setField("confirmPassword", props.confirmPassword);
        }
      }}
    >
      fill
    </button>
  );
}

function SetField(props: {
  name: RegistrationField;
  value: string;
  testId: string;
}) {
  const form = useAccountRegistrationForm();
  return (
    <button
      type="button"
      data-testid={props.testId}
      onClick={() => form.setField(props.name, props.value)}
    >
      set
    </button>
  );
}

function ErrorProbe() {
  const form = useAccountRegistrationForm();
  return (
    <span data-testid="field-errors">{JSON.stringify(form.errors)}</span>
  );
}

const REGISTERED = {
  user: { id: "user-1", email: "ada@example.com", name: "Ada" },
  session: { epMemberId: "member-1", epAccessToken: "leaked-token" },
  accounts: [{ id: "ignored-account", name: "Ignored" }],
  total: 99,
};

function installFetch(options?: {
  hangRegister?: boolean;
  hangReload?: boolean;
  registerStatus?: number;
  registerCode?: string;
  registerMessage?: string;
  reloadSessionFails?: boolean;
  postRegisterSession?: Record<string, unknown>;
  roster?: { accounts: unknown[]; total: number };
  member?: unknown;
  memberFails?: boolean;
}) {
  let getSessionCount = 0;
  let releaseRegister: () => void = () => {};
  let releaseReload: () => void = () => {};
  const registerGate = new Promise<void>((resolve) => {
    releaseRegister = resolve;
  });
  const reloadGate = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  const fetchImpl = jest.fn((url: string) => {
    const target = String(url);
    if (target.endsWith("/get-session")) {
      getSessionCount += 1;
      if (options?.reloadSessionFails && getSessionCount > 1) {
        return jsonResponse({ message: "unavailable" }, false, 502);
      }
      if (options?.hangReload && getSessionCount > 1) {
        return reloadGate.then(() =>
          jsonResponse({
            session: options.postRegisterSession ?? { epMemberId: "member-1" },
          })
        );
      }
      if (options?.postRegisterSession && getSessionCount > 1) {
        return jsonResponse({ session: options.postRegisterSession });
      }
      return jsonResponse({ session: {} });
    }
    if (target.includes("/account/register")) {
      const response = options?.registerMessage
        ? jsonResponse(
            {
              code: options.registerCode ?? "registration_rejected",
              message: options.registerMessage,
            },
            false,
            options.registerStatus ?? 400
          )
        : jsonResponse(REGISTERED);
      return options?.hangRegister
        ? registerGate.then(() => response)
        : response;
    }
    if (target.includes("/account/roster")) {
      return jsonResponse(options?.roster ?? { accounts: [], total: 0 });
    }
    if (target.includes("/account/member")) {
      if (options?.memberFails) {
        return jsonResponse(
          {
            code: "account_member_read_failed",
            message: "Elastic Path rejected the account-member read.",
          },
          false,
          502
        );
      }
      if (options?.member !== undefined) return jsonResponse(options.member);
      const session = options?.postRegisterSession;
      const id =
        session && typeof session.epMemberId === "string"
          ? session.epMemberId
          : "member-1";
      return jsonResponse({ id });
    }
    return jsonResponse({}, false);
  });
  (global as unknown as { fetch: typeof fetch }).fetch =
    fetchImpl as typeof fetch;
  return { fetchImpl, releaseRegister, releaseReload, getSessionCount: () => getSessionCount };
}

function registerCalls(fetchImpl: jest.Mock) {
  return fetchImpl.mock.calls.filter(([url]) =>
    String(url).includes("/account/register")
  );
}

function registerBody(fetchImpl: jest.Mock) {
  return JSON.parse(String(registerCalls(fetchImpl)[0][1]?.body));
}

const FILLED: FillValues = {
  name: "Ada",
  email: "ada@example.com",
  password: "secret",
};

describe("EPAccountRegistrationFormProvider", () => {
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

  function renderForm(options?: {
    redirectUrl?: string;
    present?: RegistrationField[];
    fill?: FillValues;
  }) {
    const ref = React.createRef<RegistrationActions>();
    render(
      <EPAccountProvider>
        <EPAccountRegistrationFormProvider
          ref={ref}
          redirectUrl={options?.redirectUrl}
        >
          <RegisterFields names={options?.present ?? []} />
          <Fill {...(options?.fill ?? FILLED)} />
          <ErrorProbe />
        </EPAccountRegistrationFormProvider>
      </EPAccountProvider>
    );
    return ref;
  }

  async function submitFilled(options?: {
    redirectUrl?: string;
    present?: RegistrationField[];
    fill?: FillValues;
  }) {
    const installed = installFetch();
    const ref = renderForm(options);
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    return { ...installed, ref };
  }

  it("requires name, email, and password even when those fields are not mounted", async () => {
    const { fetchImpl } = installFetch();
    const ref = renderForm({ fill: {} });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(publishedForm()).toEqual({
      status: "error",
      error: "Please complete the required fields.",
      isSubmitting: false,
    });
    expect(fieldErrors()).toEqual({
      name: "This field is required",
      email: "This field is required",
      username: null,
      password: "This field is required",
      confirmPassword: null,
    });
  });

  it("rejects an invalid email before calling register", async () => {
    const { fetchImpl } = installFetch();
    const ref = renderForm({ fill: { ...FILLED, email: "not-an-email" } });
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(publishedForm().error).toBe("Enter a valid email address.");
    expect(fieldErrors().email).toBe("Enter a valid email address.");
    expect(fieldErrors().name).toBeNull();
  });

  it("reports missing required fields before an invalid email", async () => {
    const { fetchImpl } = installFetch();
    const ref = renderForm({ fill: { ...FILLED, name: " ", email: "not-an-email" } });
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(publishedForm().error).toBe("Please complete the required fields.");
    expect(fieldErrors().name).toBe("This field is required");
    expect(fieldErrors().email).toBeNull();
  });

  it("uses the trimmed email as the username when no username field is registered", async () => {
    const { fetchImpl } = await submitFilled({
      fill: {
        name: "  Ada  ",
        email: "  ada@example.com  ",
        password: " secret ",
      },
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(String(registerCalls(fetchImpl)[0][0])).toBe(
      "/api/ep/ep/account/register"
    );
    expect(registerBody(fetchImpl)).toEqual({
      username: "ada@example.com",
      password: " secret ",
      name: "Ada",
      email: "ada@example.com",
    });
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
  });

  it("sends a separate trimmed username when that field is registered", async () => {
    const { fetchImpl } = await submitFilled({
      present: ["username"],
      fill: { ...FILLED, username: "  buyer  " },
    });
    expect(registerBody(fetchImpl)).toEqual({
      username: "buyer",
      password: "secret",
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("requires username when that field is registered and empty", async () => {
    const { fetchImpl } = installFetch();
    const ref = renderForm({
      present: ["username"],
      fill: { ...FILLED, username: "  " },
    });
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(fieldErrors().username).toBe("This field is required");
    expect(publishedForm().error).toBe("Please complete the required fields.");
  });

  it("does not check confirmPassword when that field is not registered", async () => {
    const { fetchImpl } = await submitFilled({
      fill: { ...FILLED, confirmPassword: "different" },
    });
    expect(registerBody(fetchImpl)).toEqual({
      username: "ada@example.com",
      password: "secret",
      name: "Ada",
      email: "ada@example.com",
    });
    expect(registerBody(fetchImpl)).not.toHaveProperty("confirmPassword");
  });

  it("accepts a matching confirmPassword and does not send it", async () => {
    const { fetchImpl } = await submitFilled({
      present: ["confirmPassword"],
      fill: { ...FILLED, confirmPassword: "secret" },
    });
    expect(registerBody(fetchImpl)).toEqual({
      username: "ada@example.com",
      password: "secret",
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("rejects a confirmPassword that does not match", async () => {
    const { fetchImpl } = installFetch();
    const ref = renderForm({
      present: ["confirmPassword"],
      fill: { ...FILLED, confirmPassword: "other" },
    });
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(fieldErrors().confirmPassword).toBe("Passwords do not match.");
    expect(publishedForm().error).toBe("Passwords do not match.");
  });

  it("requires confirmPassword when that field is registered and empty", async () => {
    const { fetchImpl } = installFetch();
    const ref = renderForm({
      present: ["confirmPassword"],
      fill: { ...FILLED, confirmPassword: "" },
    });
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(fieldErrors().confirmPassword).toBe("This field is required");
    expect(publishedForm().error).toBe("Please complete the required fields.");
  });

  it("issues one register when submit is repeated while in flight", async () => {
    const { fetchImpl, releaseRegister } = installFetch({ hangRegister: true });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = ref.current!.submit();
      void ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm().isSubmitting).toBe(true);

    await act(async () => {
      releaseRegister();
      await first;
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
  });

  it("ignores an invalid resubmit while registration is in flight", async () => {
    const { fetchImpl, releaseRegister } = installFetch({ hangRegister: true });
    const ref = React.createRef<RegistrationActions>();
    render(
      <EPAccountProvider>
        <EPAccountRegistrationFormProvider ref={ref}>
          <Fill {...FILLED} />
          <SetField name="name" value="" testId="clear-name" />
          <ErrorProbe />
        </EPAccountRegistrationFormProvider>
      </EPAccountProvider>
    );
    fireEvent.click(screen.getByTestId("fill"));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm()).toEqual({
      status: "submitting",
      error: null,
      isSubmitting: true,
    });
    const errorsWhileSubmitting = fieldErrors();

    fireEvent.click(screen.getByTestId("clear-name"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm()).toEqual({
      status: "submitting",
      error: null,
      isSubmitting: true,
    });
    expect(fieldErrors()).toEqual(errorsWhileSubmitting);

    await act(async () => {
      releaseRegister();
      await first;
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
  });

  it("keeps the original registration failure when a later submit is invalid", async () => {
    const { fetchImpl, releaseRegister } = installFetch({
      hangRegister: true,
      registerMessage: "Password must contain a number",
    });
    const ref = React.createRef<RegistrationActions>();
    render(
      <EPAccountProvider>
        <EPAccountRegistrationFormProvider ref={ref}>
          <Fill {...FILLED} />
          <SetField name="email" value="" testId="clear-email" />
          <ErrorProbe />
        </EPAccountRegistrationFormProvider>
      </EPAccountProvider>
    );
    fireEvent.click(screen.getByTestId("fill"));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = ref.current!.submit();
    });
    fireEvent.click(screen.getByTestId("clear-email"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm().status).toBe("submitting");
    expect(publishedForm().isSubmitting).toBe(true);
    expect(fieldErrors().email).toBeNull();

    await act(async () => {
      releaseRegister();
      await first;
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm()).toEqual({
      status: "error",
      error: "Password must contain a number",
      isSubmitting: false,
    });
    expect(fieldErrors().email).toBeNull();
  });

  it("keeps credentials out of the Studio data", async () => {
    await submitFilled({
      present: ["username", "confirmPassword"],
      fill: {
        ...FILLED,
        username: "buyer",
        confirmPassword: "secret",
      },
    });
    const raw = screen
      .getByTestId("data-provider-accountRegistrationFormData")
      .getAttribute("data-value")!;
    expect(raw).not.toMatch(/ada@example.com/);
    expect(raw).not.toMatch(/secret/);
    expect(raw).not.toMatch(/buyer/);
    expect(raw).not.toMatch(/Ada/);
    expect(JSON.parse(raw)).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
    const accountRaw = screen
      .getByTestId("data-provider-account")
      .getAttribute("data-value")!;
    expect(accountRaw).not.toMatch(/secret/);
    expect(accountRaw).not.toMatch(/leaked-token/);
    expect(accountRaw).not.toMatch(/ignored-account/);
  });

  it("surfaces a registration_rejected message unchanged and does not reload", async () => {
    const { fetchImpl } = installFetch({
      registerMessage: "Password must contain a number",
      registerStatus: 400,
    });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(publishedForm()).toEqual({
      status: "error",
      error: "Password must contain a number",
      isSubmitting: false,
    });
    expect(
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/get-session"))
    ).toHaveLength(1);
  });

  it("surfaces a token-call failure message unchanged and does not reload", async () => {
    const message =
      "Elastic Path rejected the account-token call: token request failed";
    const { fetchImpl } = installFetch({
      registerMessage: message,
      registerCode: "account_token_mint_failed",
      registerStatus: 502,
    });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(publishedForm()).toEqual({
      status: "error",
      error: message,
      isSubmitting: false,
    });
    expect(
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/get-session"))
    ).toHaveLength(1);
  });

  it("surfaces a password-profile failure message unchanged", async () => {
    const message =
      "Set passwordProfileId on createEpAuth. The authentication realm has several password profiles.";
    const { fetchImpl } = installFetch({
      registerMessage: message,
      registerCode: "password_profile_ambiguous",
      registerStatus: 500,
    });
    const ref = renderForm();
    fireEvent.click(screen.getByTestId("fill"));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm().error).toBe(message);
    expect(publishedForm().status).toBe("error");
  });

  it("does not validate, register, or change status in the canvas", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    const { fetchImpl } = installFetch();
    const ref = renderForm();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(publishedForm()).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });
    expect(fieldErrors().name).toBeNull();
  });

  describe("account reload", () => {
    async function registerAndReload(options: {
      postRegisterSession: Record<string, unknown>;
      roster: { accounts: unknown[]; total: number };
      member?: unknown;
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
      expect(registerCalls(installed.fetchImpl)).toHaveLength(1);
      return installed;
    }

    it("publishes member name and email from identity.member()", async () => {
      await registerAndReload({
        postRegisterSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-1", name: "Acme" },
        },
        roster: { accounts: [{ id: "acct-1", name: "Acme" }], total: 1 },
        member: {
          id: "member-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
      });
      expect(publishedAccount().accountMember).toEqual({
        id: "member-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      });
      expect(publishedAccount().state).toBe("selected");
    });

    it("publishes memberOnly when registration leaves no organisation", async () => {
      await registerAndReload({
        postRegisterSession: { epMemberId: "member-1" },
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

    it("publishes selected when the reloaded session has one account", async () => {
      await registerAndReload({
        postRegisterSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-1", name: "Acme", token: "account-token" },
        },
        roster: { accounts: [{ id: "acct-1", name: "Acme" }], total: 1 },
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
      expect(JSON.stringify(publishedAccount())).not.toMatch(/account-token/);
    });

    it("publishes memberOnly with the roster when several accounts are unselected", async () => {
      await registerAndReload({
        postRegisterSession: { epMemberId: "member-1" },
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
  });

  it("registers a submit ref action and no credential props", () => {
    expect(epAccountRegistrationFormProviderMeta.name).toBe(
      "plasmic-commerce-ep-account-registration-form-provider"
    );
    expect(epAccountRegistrationFormProviderMeta.displayName).toBe(
      "EP Account Registration Form Provider"
    );
    expect(epAccountRegistrationFormProviderMeta.importName).toBe(
      "EPAccountRegistrationFormProvider"
    );
    expect(epAccountRegistrationFormProviderMeta.importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path"
    );
    expect(epAccountRegistrationFormProviderMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-account-provider"
    );
    expect(epAccountRegistrationFormProviderMeta.providesData).toBe(true);
    expect(epAccountRegistrationFormProviderMeta.refActions?.submit).toEqual(
      expect.objectContaining({ argTypes: [] })
    );
    expect(epAccountRegistrationFormProviderMeta.props).not.toHaveProperty(
      "username"
    );
    expect(epAccountRegistrationFormProviderMeta.props).not.toHaveProperty(
      "password"
    );
    expect(epAccountRegistrationFormProviderMeta.props).not.toHaveProperty(
      "passwordProfileId"
    );
    expect(epAccountRegistrationFormProviderMeta.props.redirectUrl).toEqual(
      expect.objectContaining({ type: "string", displayName: "Redirect URL" })
    );
    const children = epAccountRegistrationFormProviderMeta.props.children as any;
    expect(children.defaultValue.map((slot: any) => slot.props.name)).toEqual([
      "name",
      "email",
      "password",
    ]);
    const loader = { registerComponent: jest.fn() };
    registerEPAccountRegistrationFormProvider(loader);
    expect(loader.registerComponent).toHaveBeenCalledWith(
      EPAccountRegistrationFormProvider,
      epAccountRegistrationFormProviderMeta
    );
  });

  describe("return-to redirect", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      delete (window as any).location;
      (window as any).location = { assign: jest.fn(), search: "" };
    });

    afterEach(() => {
      (window as any).location = originalLocation;
      jest.useRealTimers();
    });

    function setSearch(search: string) {
      (window as any).location.search = search;
    }

    async function register(props?: { redirectUrl?: string }) {
      installFetch({
        postRegisterSession: { epMemberId: "member-1" },
      });
      const ref = renderForm(props);
      await waitFor(() => {
        expect(publishedAccount().isLoading).toBe(false);
      });
      fireEvent.click(screen.getByTestId("fill"));
      await act(async () => {
        await ref.current!.submit();
      });
    }

    it("navigates after a failed member profile read", async () => {
      const { fetchImpl } = installFetch({
        postRegisterSession: {
          epMemberId: "member-1",
          epAccount: { id: "acct-1", name: "Acme" },
        },
        roster: { accounts: [{ id: "acct-1", name: "Acme" }], total: 1 },
        memberFails: true,
      });
      const ref = renderForm({ redirectUrl: "/account" });
      await waitFor(() => {
        expect(publishedAccount().isLoading).toBe(false);
      });
      fireEvent.click(screen.getByTestId("fill"));
      await act(async () => {
        await ref.current!.submit();
      });

      expect(
        fetchImpl.mock.calls.filter(([url]) =>
          String(url).includes("/account/member")
        )
      ).not.toHaveLength(0);
      expect(publishedForm()).toEqual({
        status: "submitted",
        error: null,
        isSubmitting: false,
      });
      expect(publishedAccount().accountMember).toEqual({ id: "member-1" });
      expect(publishedAccount().selectedAccount).toEqual({
        id: "acct-1",
        name: "Acme",
      });
      expect(publishedAccount().accountRoster).toEqual({
        accounts: [{ id: "acct-1", name: "Acme" }],
        total: 1,
      });
      expect(publishedAccount().isLoading).toBe(false);
      expect(window.location.assign).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith("/account");
    });

    it("navigates to a configured /account after the reload fulfills", async () => {
      await register({ redirectUrl: "/account" });
      expect(window.location.assign).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith("/account");
      expect(publishedForm()).toEqual({
        status: "submitted",
        error: null,
        isSubmitting: false,
      });
    });

    it("navigates to a configured path that includes a query string", async () => {
      await register({ redirectUrl: "/account?welcome=1" });
      expect(window.location.assign).toHaveBeenCalledWith(
        "/account?welcome=1"
      );
    });

    it("lets a valid ?redirect= override the configured path", async () => {
      setSearch("?redirect=/checkout");
      await register({ redirectUrl: "/account" });
      expect(window.location.assign).toHaveBeenCalledWith("/checkout");
    });

    it("falls back to redirectUrl when ?redirect= is unsafe", async () => {
      setSearch("?redirect=//host");
      await register({ redirectUrl: "/account" });
      expect(window.location.assign).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith("/account");
    });

    it.each([
      ["?redirect=/\\host", "/account"],
      ["?redirect=https://shop.example/account", "/account"],
      ["?redirect=javascript:alert(1)", "/account"],
      ["?redirect=/account\n", "/account"],
    ])("rejects %s and uses the configured path", async (search, expected) => {
      setSearch(search);
      await register({ redirectUrl: "/account" });
      expect(window.location.assign).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith(expected);
    });

    it("does not navigate when the query and redirectUrl are both invalid", async () => {
      setSearch("?redirect=javascript:alert(1)");
      await register({ redirectUrl: "https://shop.example/account" });
      expect(publishedForm().status).toBe("submitted");
      expect(publishedForm().error).toBeNull();
      expect(window.location.assign).not.toHaveBeenCalled();
    });

    it("does not navigate when redirect support is unused", async () => {
      await register();
      expect(window.location.assign).not.toHaveBeenCalled();
    });

    it("does not navigate until reloadAccount fulfills", async () => {
      const { releaseReload } = installFetch({ hangReload: true });
      const ref = renderForm({ redirectUrl: "/account" });
      fireEvent.click(screen.getByTestId("fill"));

      let submit: Promise<void> = Promise.resolve();
      await act(async () => {
        submit = ref.current!.submit();
      });

      expect(publishedForm().isSubmitting).toBe(true);
      expect(window.location.assign).not.toHaveBeenCalled();

      await act(async () => {
        releaseReload();
        await submit;
      });
      expect(window.location.assign).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith("/account");
    });

    it("does not redirect when registration succeeds and the reload fails, even after a later retry succeeds", async () => {
      jest.useFakeTimers();
      let getSessionCount = 0;
      const fetchImpl = jest.fn((url: string) => {
        const target = String(url);
        if (target.endsWith("/get-session")) {
          getSessionCount += 1;
          if (getSessionCount === 1) {
            return jsonResponse({ session: {} });
          }
          if (getSessionCount === 2) {
            return jsonResponse({ message: "unavailable" }, false, 502);
          }
          return jsonResponse({
            session: { epMemberId: "member-recovered" },
          });
        }
        if (target.includes("/account/register")) {
          return jsonResponse(REGISTERED);
        }
        if (target.includes("/account/roster")) {
          return jsonResponse({ accounts: [], total: 0 });
        }
        return jsonResponse({}, false);
      });
      (global as unknown as { fetch: typeof fetch }).fetch =
        fetchImpl as typeof fetch;

      const ref = renderForm({ redirectUrl: "/account" });
      async function flushPromises() {
        await act(async () => {
          for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
      }
      await flushPromises();
      fireEvent.click(screen.getByTestId("fill"));
      await act(async () => {
        await ref.current!.submit();
      });

      expect(publishedForm()).toEqual({
        status: "submitted",
        error: "Registered, but the account could not be refreshed.",
        isSubmitting: false,
      });
      expect(getSessionCount).toBe(2);
      expect(publishedAccount().isLoading).toBe(true);
      expect(window.location.assign).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(RELOAD_RETRY_BACKOFF_MS[0] - 1);
      });
      await flushPromises();
      expect(getSessionCount).toBe(2);
      expect(window.location.assign).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      await flushPromises();
      expect(getSessionCount).toBe(3);
      expect(publishedAccount().accountMember).toEqual({
        id: "member-recovered",
      });
      expect(publishedAccount().isLoading).toBe(false);
      expect(window.location.assign).not.toHaveBeenCalled();
    });

    it("does not register or navigate in the Studio canvas", async () => {
      mockUsePlasmicCanvasContext.mockReturnValue(true);
      setSearch("?redirect=/checkout");
      const { fetchImpl } = installFetch();
      const ref = renderForm({ redirectUrl: "/account" });
      fireEvent.click(screen.getByTestId("fill"));
      await act(async () => {
        await ref.current!.submit();
      });
      expect(registerCalls(fetchImpl)).toEqual([]);
      expect(window.location.assign).not.toHaveBeenCalled();
      expect(publishedForm()).toEqual({
        status: "idle",
        error: null,
        isSubmitting: false,
      });
    });
  });
});
