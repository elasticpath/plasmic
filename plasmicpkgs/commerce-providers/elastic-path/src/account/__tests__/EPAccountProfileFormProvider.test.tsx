/**
 * @jest-environment jsdom
 *
 * EPAccountProfileFormProvider — sends only changed profile fields, then
 * reloads the surrounding Account Provider.
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
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { EPAccountProvider, useAccountReload } = require("../EPAccountProvider");
const {
  EPAccountProfileFormProvider,
  epAccountProfileFormProviderMeta,
} = require("../EPAccountProfileFormProvider");
const { EPAccountProfileField } = require("../EPAccountProfileField");

interface ProfileActions {
  submit(): Promise<void>;
}

const SEEDED = {
  id: "member-1",
  name: "Test 1",
  email: "old@example.com",
};

function publishedForm() {
  return JSON.parse(
    screen
      .getByTestId("data-provider-accountProfileFormData")
      .getAttribute("data-value")!
  );
}

function publishedAccount() {
  return JSON.parse(
    screen.getByTestId("data-provider-account").getAttribute("data-value")!
  );
}

function inputValue(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 401,
    json: () => Promise.resolve(body),
  });
}

function ReloadButton() {
  const reload = useAccountReload();
  return (
    <button type="button" data-testid="reload" onClick={() => void reload()}>
      reload
    </button>
  );
}

function installFetch(options?: {
  member?: unknown;
  hangUpdate?: boolean;
  failReloadSession?: boolean;
  hangSessionRead?: number;
}) {
  let sessionReads = 0;
  let releaseUpdate: () => void = () => {};
  let releaseSession: () => void = () => {};
  const updateGate = new Promise<void>((resolve) => {
    releaseUpdate = resolve;
  });
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  let memberBody = options?.member ?? SEEDED;
  const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/account/member/update")) {
      const response = jsonResponse({ id: "member-1" });
      return options?.hangUpdate ? updateGate.then(() => response) : response;
    }
    if (target.endsWith("/get-session")) {
      sessionReads += 1;
      if (options?.failReloadSession && sessionReads > 1) {
        return jsonResponse({ message: "session unavailable" }, false);
      }
      const response = jsonResponse({ session: { epMemberId: "member-1" } });
      if (options?.hangSessionRead === sessionReads) {
        return sessionGate.then(() => response);
      }
      return response;
    }
    if (target.includes("/account/roster")) {
      return jsonResponse({ accounts: [], total: 0 });
    }
    if (target.includes("/account/member")) {
      return jsonResponse(memberBody);
    }
    return jsonResponse({}, false);
  });
  (global as unknown as { fetch: typeof fetch }).fetch =
    fetchImpl as typeof fetch;
  return {
    fetchImpl,
    releaseUpdate,
    releaseSession,
    setMember(body: unknown) {
      memberBody = body;
    },
  };
}

function updateCalls(fetchImpl: jest.Mock) {
  return fetchImpl.mock.calls.filter(([url]) =>
    String(url).includes("/account/member/update")
  );
}

function updateBody(fetchImpl: jest.Mock) {
  return updateCalls(fetchImpl).map((call) =>
    JSON.parse(String(call[1]?.body))
  );
}

describe("EPAccountProfileFormProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePlasmicCanvasContext.mockReturnValue(false);
  });

  afterEach(() => {
    delete (global as unknown as { fetch?: typeof fetch }).fetch;
  });

  function renderForm() {
    const ref = React.createRef<ProfileActions>();
    render(
      <EPAccountProvider>
        <EPAccountProfileFormProvider ref={ref}>
          <EPAccountProfileField name="name" />
          <EPAccountProfileField name="email" />
          <ReloadButton />
        </EPAccountProfileFormProvider>
      </EPAccountProvider>
    );
    return ref;
  }

  async function renderSeeded(installed = installFetch()) {
    const ref = renderForm();
    await waitFor(() => {
      expect(inputValue("Name")).toBe("Test 1");
      expect(inputValue("Email")).toBe("old@example.com");
    });
    return { ref, ...installed };
  }

  it("seeds name and email from accountMember and publishes no field values", async () => {
    await renderSeeded();
    expect(publishedAccount().accountMember).toEqual(SEEDED);
    expect(publishedForm()).toEqual({
      status: "idle",
      error: null,
      isSubmitting: false,
    });
    expect(Object.keys(publishedForm()).sort()).toEqual([
      "error",
      "isSubmitting",
      "status",
    ]);
    expect(
      screen
        .getByTestId("data-provider-accountProfileFormData")
        .getAttribute("data-value")
    ).not.toContain("Test 1");
    expect(
      screen
        .getByTestId("data-provider-accountProfileFormData")
        .getAttribute("data-value")
    ).not.toContain("old@example.com");
  });

  it("submits only a changed name, then reloads the account", async () => {
    const { ref, fetchImpl, setMember } = await renderSeeded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Name" },
    });
    setMember({ ...SEEDED, name: "New Name" });

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateBody(fetchImpl)).toEqual([{ name: "New Name" }]);
    expect(inputValue("Name")).toBe("New Name");
    expect(inputValue("Email")).toBe("old@example.com");
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
    expect(publishedAccount().accountMember).toEqual({
      ...SEEDED,
      name: "New Name",
    });
  });

  it("submits only a changed email", async () => {
    const { ref, fetchImpl } = await renderSeeded();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateBody(fetchImpl)).toEqual([{ email: "new@example.com" }]);
  });

  it("submits both fields when both changed", async () => {
    const { ref, fetchImpl } = await renderSeeded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Name" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateBody(fetchImpl)).toEqual([
      { name: "New Name", email: "new@example.com" },
    ]);
  });

  it("does not write when nothing changed", async () => {
    const { ref, fetchImpl } = await renderSeeded();
    const callsBefore = fetchImpl.mock.calls.length;

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateCalls(fetchImpl)).toEqual([]);
    expect(fetchImpl.mock.calls.length).toBe(callsBefore);
    expect(publishedForm().status).toBe("idle");
  });

  it("does not let an account reload replace a dirty field", async () => {
    const { fetchImpl, setMember } = await renderSeeded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Name" },
    });
    setMember({ ...SEEDED, name: "From reload" });

    await act(async () => {
      fireEvent.click(screen.getByTestId("reload"));
    });
    await waitFor(() => {
      expect(publishedAccount().accountMember.name).toBe("From reload");
    });

    expect(inputValue("Name")).toBe("New Name");
    expect(inputValue("Email")).toBe("old@example.com");
    expect(updateCalls(fetchImpl)).toEqual([]);
  });

  it("ignores a second submit while the first is in flight", async () => {
    const { ref, fetchImpl, releaseUpdate } = await renderSeeded(
      installFetch({ hangUpdate: true })
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Name" },
    });

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = ref.current!.submit();
      second = ref.current!.submit();
    });
    expect(updateCalls(fetchImpl)).toHaveLength(1);
    expect(publishedForm().isSubmitting).toBe(true);

    await act(async () => {
      releaseUpdate();
      await first;
      await second;
    });
    expect(updateCalls(fetchImpl)).toHaveLength(1);
  });

  it("does not submit from the Studio canvas", async () => {
    mockUsePlasmicCanvasContext.mockReturnValue({});
    const installed = installFetch();
    const ref = renderForm();
    await waitFor(() => {
      expect(inputValue("Name")).toBe("Test 1");
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).readOnly).toBe(
      true
    );
    expect((screen.getByLabelText("Email") as HTMLInputElement).readOnly).toBe(
      true
    );

    await act(async () => {
      await ref.current!.submit();
    });
    expect(updateCalls(installed.fetchImpl)).toEqual([]);
  });

  it("reports a refresh failure without calling the write a failure", async () => {
    const { ref, fetchImpl } = await renderSeeded(
      installFetch({ failReloadSession: true })
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Name" },
    });

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateBody(fetchImpl)).toEqual([{ name: "New Name" }]);
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: "Updated, but the account could not be refreshed.",
      isSubmitting: false,
    });
    expect(inputValue("Name")).toBe("New Name");
  });

  it("still accepts an edit when accountMember is only an id", async () => {
    const installed = installFetch({ member: { id: "member-1" } });
    const ref = renderForm();
    await waitFor(() => {
      expect(publishedAccount().accountMember).toEqual({ id: "member-1" });
    });
    expect(inputValue("Name")).toBe("");
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(
      false
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Ada Lovelace" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(updateBody(installed.fetchImpl)).toEqual([{ name: "Ada Lovelace" }]);
  });

  it("keeps a newer reload ahead of an older one started before the write", async () => {
    const { ref, fetchImpl, releaseSession, setMember } = await renderSeeded(
      installFetch({ hangSessionRead: 2 })
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("reload"));
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Name" },
    });
    setMember({ ...SEEDED, name: "New Name" });

    await act(async () => {
      await ref.current!.submit();
    });
    expect(publishedAccount().accountMember.name).toBe("New Name");

    setMember({ ...SEEDED, name: "Stale Name" });
    await act(async () => {
      releaseSession();
      await Promise.resolve();
    });
    expect(publishedAccount().accountMember.name).toBe("New Name");
    expect(updateBody(fetchImpl)).toEqual([{ name: "New Name" }]);
  });

  it("keeps a trailing space typed onto the seeded name", async () => {
    await renderSeeded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Test 1 " },
    });
    expect(inputValue("Name")).toBe("Test 1 ");

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Test 1 Lovelace" },
    });
    expect(inputValue("Name")).toBe("Test 1 Lovelace");
  });

  it("does not send a value whose trim still matches the seeded value", async () => {
    const { ref, fetchImpl } = await renderSeeded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Test 1 " },
    });

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateCalls(fetchImpl)).toEqual([]);
    expect(inputValue("Name")).toBe("Test 1 ");
    expect(publishedForm().status).toBe("idle");
  });

  it("locks the fields while submitting and then shows the refreshed account", async () => {
    const { ref, fetchImpl, releaseUpdate, setMember } = await renderSeeded(
      installFetch({ hangUpdate: true })
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Test 1 " },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    setMember({ ...SEEDED, email: "new@example.com" });

    let pending = Promise.resolve();
    await act(async () => {
      pending = ref.current!.submit();
    });

    const name = screen.getByLabelText("Name") as HTMLInputElement;
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(publishedForm().isSubmitting).toBe(true);
    expect(name.readOnly).toBe(true);
    expect(email.readOnly).toBe(true);
    expect(name.value).toBe("Test 1 ");

    fireEvent.change(name, { target: { value: "Newer Name" } });
    expect(name.value).toBe("Test 1 ");

    await act(async () => {
      releaseUpdate();
      await pending;
    });

    expect(updateBody(fetchImpl)).toEqual([{ email: "new@example.com" }]);
    expect(inputValue("Name")).toBe("Test 1");
    expect(inputValue("Email")).toBe("new@example.com");
    expect(name.readOnly).toBe(false);
    expect(email.readOnly).toBe(false);
    expect(publishedForm()).toEqual({
      status: "submitted",
      error: null,
      isSubmitting: false,
    });
  });

  it("keeps the fields locked while the account reload is in flight", async () => {
    const { ref, releaseSession, setMember } = await renderSeeded(
      installFetch({ hangSessionRead: 2 })
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Name" },
    });
    setMember({ ...SEEDED, name: "New Name" });

    let pending = Promise.resolve();
    await act(async () => {
      pending = ref.current!.submit();
    });
    expect(publishedForm().isSubmitting).toBe(true);
    expect(
      (screen.getByLabelText("Name") as HTMLInputElement).readOnly
    ).toBe(true);

    await act(async () => {
      releaseSession();
      await pending;
    });

    expect(inputValue("Name")).toBe("New Name");
    expect(
      (screen.getByLabelText("Name") as HTMLInputElement).readOnly
    ).toBe(false);
  });

  it("rejects an empty edit before writing", async () => {
    const { ref, fetchImpl } = await renderSeeded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "   " },
    });

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateCalls(fetchImpl)).toEqual([]);
    expect(publishedForm()).toEqual({
      status: "error",
      error: "Please complete the required fields.",
      isSubmitting: false,
    });
    expect(screen.getByText("This field is required")).toBeTruthy();
  });

  it("uses the invalid-email message when that is the only problem", async () => {
    const { ref, fetchImpl } = await renderSeeded();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "not-an-email" },
    });

    await act(async () => {
      await ref.current!.submit();
    });

    expect(updateCalls(fetchImpl)).toEqual([]);
    expect(publishedForm()).toEqual({
      status: "error",
      error: "Enter a valid email address.",
      isSubmitting: false,
    });
    expect(publishedForm().error).not.toBe("This field is required");
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.queryByText("This field is required")).toBeNull();
  });

  it("registers inside the account provider", () => {
    expect(epAccountProfileFormProviderMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-account-provider"
    );
    expect(epAccountProfileFormProviderMeta.providesData).toBe(true);
  });
});
