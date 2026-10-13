/**
 * @jest-environment jsdom
 *
 * EPAccountRegistrationField — binds to the registration form context.
 * Credentials stay off Studio data providers.
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

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { EPAccountProvider } = require("../EPAccountProvider");
const { EPAccountRegistrationFormProvider } = require("../EPAccountRegistrationFormProvider");
const {
  EPAccountRegistrationField,
  epAccountRegistrationFieldMeta,
  registerEPAccountRegistrationField,
} = require("../EPAccountRegistrationField");

interface RegistrationActions {
  submit(): Promise<void>;
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
  });
}

function installFetch() {
  const fetchImpl = jest.fn((url: string) => {
    const target = String(url);
    if (target.endsWith("/get-session")) {
      return jsonResponse({ session: {} });
    }
    if (target.includes("/account/register")) {
      return jsonResponse({
        session: { epMemberId: "member-1" },
        accounts: [],
        total: 0,
      });
    }
    if (target.includes("/account/roster")) {
      return jsonResponse({ accounts: [], total: 0 });
    }
    return jsonResponse({}, false);
  });
  (global as unknown as { fetch: typeof fetch }).fetch =
    fetchImpl as typeof fetch;
  return fetchImpl;
}

function registerCalls(fetchImpl: jest.Mock) {
  return fetchImpl.mock.calls.filter(([url]) =>
    String(url).includes("/account/register")
  );
}

function Fields(props: { username?: boolean; confirmPassword?: boolean }) {
  return (
    <>
      <EPAccountRegistrationField name="name" label="Name" />
      <EPAccountRegistrationField name="email" label="Email" />
      {props.username ? (
        <EPAccountRegistrationField name="username" label="Username" />
      ) : null}
      <EPAccountRegistrationField name="password" label="Password" />
      {props.confirmPassword ? (
        <EPAccountRegistrationField
          name="confirmPassword"
          label="Confirm password"
        />
      ) : null}
    </>
  );
}

function fillCommon() {
  fireEvent.change(screen.getByLabelText("Name *"), {
    target: { value: "Ada" },
  });
  fireEvent.change(screen.getByLabelText("Email *"), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password *"), {
    target: { value: "secret" },
  });
}

describe("EPAccountRegistrationField", () => {
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

  function renderFields(
    fields: React.ReactElement,
    ref = React.createRef<RegistrationActions>()
  ) {
    const view = render(
      <EPAccountProvider>
        <EPAccountRegistrationFormProvider ref={ref}>
          {fields}
        </EPAccountRegistrationFormProvider>
      </EPAccountProvider>
    );
    return { ...view, ref };
  }

  it("renders each field with its input type and autocomplete", () => {
    renderFields(<Fields username confirmPassword />);
    expect((screen.getByLabelText("Name *") as HTMLInputElement).type).toBe(
      "text"
    );
    expect(
      screen.getByLabelText("Name *").getAttribute("autocomplete")
    ).toBe("name");
    expect((screen.getByLabelText("Email *") as HTMLInputElement).type).toBe(
      "email"
    );
    expect(
      screen.getByLabelText("Email *").getAttribute("autocomplete")
    ).toBe("email");
    expect(
      (screen.getByLabelText("Username *") as HTMLInputElement).type
    ).toBe("text");
    expect(
      screen.getByLabelText("Username *").getAttribute("autocomplete")
    ).toBe("username");
    expect(
      (screen.getByLabelText("Password *") as HTMLInputElement).type
    ).toBe("password");
    expect(
      screen.getByLabelText("Password *").getAttribute("autocomplete")
    ).toBe("new-password");
    expect(
      (screen.getByLabelText("Confirm password *") as HTMLInputElement).type
    ).toBe("password");
    expect(
      screen.getByLabelText("Confirm password *").getAttribute("autocomplete")
    ).toBe("new-password");
  });

  it("writes values only through the registration form context", () => {
    renderFields(<Fields />);
    fillCommon();
    expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
      "Ada"
    );
    expect((screen.getByLabelText("Email *") as HTMLInputElement).value).toBe(
      "ada@example.com"
    );
    expect(
      (screen.getByLabelText("Password *") as HTMLInputElement).value
    ).toBe("secret");
  });

  it("renders required errors and does not register when name, email, or password is empty", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields />);
    fireEvent.change(screen.getByLabelText("Email *"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password *"), {
      target: { value: "secret" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(
      screen.getByLabelText("Name *").parentElement?.querySelector(
        "[data-ep-field-error]"
      )?.textContent
    ).toBe("This field is required");
    expect(screen.getByLabelText("Name *").getAttribute("aria-invalid")).toBe(
      "true"
    );
  });

  it("still requires name when the name field is removed", async () => {
    const fetchImpl = installFetch();
    const ref = React.createRef<RegistrationActions>();
    render(
      <EPAccountProvider>
        <EPAccountRegistrationFormProvider ref={ref}>
          <EPAccountRegistrationField name="email" label="Email" />
          <EPAccountRegistrationField name="password" label="Password" />
        </EPAccountRegistrationFormProvider>
      </EPAccountProvider>
    );
    fireEvent.change(screen.getByLabelText("Email *"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password *"), {
      target: { value: "secret" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    const raw = screen
      .getByTestId("data-provider-accountRegistrationFormData")
      .getAttribute("data-value")!;
    expect(JSON.parse(raw).error).toBe("Please complete the required fields.");
  });

  it("uses the email as the username when the username field is omitted", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields />);
    fillCommon();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(JSON.parse(String(registerCalls(fetchImpl)[0][1]?.body))).toEqual({
      username: "ada@example.com",
      password: "secret",
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("sends the username field's own value when it is present", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields username />);
    fillCommon();
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(JSON.parse(String(registerCalls(fetchImpl)[0][1]?.body)).username).toBe(
      "buyer"
    );
  });

  it("unregisters username so a stale value is not sent", async () => {
    const fetchImpl = installFetch();
    const ref = React.createRef<RegistrationActions>();
    const tree = (username: boolean) => (
      <EPAccountProvider>
        <EPAccountRegistrationFormProvider ref={ref}>
          <Fields username={username} />
        </EPAccountRegistrationFormProvider>
      </EPAccountProvider>
    );
    const { rerender } = render(tree(true));
    fillCommon();
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer" },
    });
    rerender(tree(false));
    expect(screen.queryByLabelText("Username *")).toBeNull();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(JSON.parse(String(registerCalls(fetchImpl)[0][1]?.body)).username).toBe(
      "ada@example.com"
    );
  });

  it("requires an empty username field and does not register", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields username />);
    fillCommon();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(
      screen.getByLabelText("Username *").parentElement?.querySelector(
        "[data-ep-field-error]"
      )?.textContent
    ).toBe("This field is required");
  });

  it("does not send confirmPassword when it matches", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields confirmPassword />);
    fillCommon();
    fireEvent.change(screen.getByLabelText("Confirm password *"), {
      target: { value: "secret" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    const body = JSON.parse(String(registerCalls(fetchImpl)[0][1]?.body));
    expect(body).not.toHaveProperty("confirmPassword");
    expect(body.password).toBe("secret");
  });

  it("shows a mismatch and does not register", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields confirmPassword />);
    fillCommon();
    fireEvent.change(screen.getByLabelText("Confirm password *"), {
      target: { value: "other" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toEqual([]);
    expect(
      screen.getByLabelText("Confirm password *").parentElement?.querySelector(
        "[data-ep-field-error]"
      )?.textContent
    ).toBe("Passwords do not match.");
  });

  it("stops checking confirmPassword after that field unmounts", async () => {
    const fetchImpl = installFetch();
    const ref = React.createRef<RegistrationActions>();
    const tree = (confirmPassword: boolean) => (
      <EPAccountProvider>
        <EPAccountRegistrationFormProvider ref={ref}>
          <Fields confirmPassword={confirmPassword} />
        </EPAccountRegistrationFormProvider>
      </EPAccountProvider>
    );
    const { rerender } = render(tree(true));
    fillCommon();
    fireEvent.change(screen.getByLabelText("Confirm password *"), {
      target: { value: "other" },
    });
    rerender(tree(false));
    await act(async () => {
      await ref.current!.submit();
    });
    expect(registerCalls(fetchImpl)).toHaveLength(1);
    expect(
      JSON.parse(String(registerCalls(fetchImpl)[0][1]?.body))
    ).not.toHaveProperty("confirmPassword");
  });

  it("does not publish credentials through a data provider", () => {
    renderFields(<Fields username confirmPassword />);
    fillCommon();
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password *"), {
      target: { value: "secret" },
    });
    const published = screen
      .getAllByTestId(/data-provider-/)
      .map((node) => node.getAttribute("data-value") ?? "");
    expect(published.length).toBeGreaterThan(0);
    for (const raw of published) {
      expect(raw).not.toMatch(/ada@example.com/);
      expect(raw).not.toMatch(/secret/);
      expect(raw).not.toMatch(/buyer/);
      expect(raw).not.toMatch(/Ada/);
    }
  });

  it("is readOnly in the Studio canvas", () => {
    mockUsePlasmicCanvasContext.mockReturnValue(true);
    renderFields(<Fields />);
    expect((screen.getByLabelText("Name *") as HTMLInputElement).readOnly).toBe(
      true
    );
    expect(
      (screen.getByLabelText("Password *") as HTMLInputElement).readOnly
    ).toBe(true);
  });

  it("registers the field with name and label only", () => {
    expect(epAccountRegistrationFieldMeta.name).toBe(
      "plasmic-commerce-ep-account-registration-field"
    );
    expect(epAccountRegistrationFieldMeta.displayName).toBe(
      "EP Account Registration Field"
    );
    expect(epAccountRegistrationFieldMeta.importName).toBe(
      "EPAccountRegistrationField"
    );
    expect(epAccountRegistrationFieldMeta.importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path"
    );
    expect(epAccountRegistrationFieldMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-account-registration-form-provider"
    );
    expect(epAccountRegistrationFieldMeta.providesData).toBeFalsy();
    expect(epAccountRegistrationFieldMeta.refActions).toBeUndefined();
    expect(Object.keys(epAccountRegistrationFieldMeta.props ?? {})).toEqual([
      "name",
      "label",
    ]);
    const props = epAccountRegistrationFieldMeta.props as any;
    expect(props.name.options).toEqual([
      "name",
      "email",
      "username",
      "password",
      "confirmPassword",
    ]);
    expect(props).not.toHaveProperty("passwordProfileId");
    expect(props).not.toHaveProperty("inputType");
    expect(props).not.toHaveProperty("required");
    const loader = { registerComponent: jest.fn() };
    registerEPAccountRegistrationField(loader);
    expect(loader.registerComponent).toHaveBeenCalledWith(
      EPAccountRegistrationField,
      epAccountRegistrationFieldMeta
    );
  });
});
