/**
 * @jest-environment jsdom
 *
 * EPAccountFormField — binds to the login form context. Credentials stay
 * off Studio data providers.
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
const { EPAccountLoginFormProvider } = require("../EPAccountLoginFormProvider");
const {
  EPAccountFormField,
  epAccountFormFieldMeta,
  registerEPAccountFormField,
} = require("../EPAccountFormField");

interface LoginActions {
  submit(): Promise<void>;
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 401,
    json: () => Promise.resolve(body),
  });
}

function installFetch() {
  const fetchImpl = jest.fn((url: string) => {
    const target = String(url);
    if (target.endsWith("/get-session")) {
      return jsonResponse({ session: {} });
    }
    if (target.includes("/account/login")) {
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

function loginCalls(fetchImpl: jest.Mock) {
  return fetchImpl.mock.calls.filter(([url]) =>
    String(url).includes("/account/login")
  );
}

function Fields(props: {
  usernameType?: "text" | "email" | "password";
  showPassword?: boolean;
  passwordRequired?: boolean;
}) {
  const {
    usernameType = "text",
    showPassword = true,
    passwordRequired = true,
  } = props;
  return (
    <>
      <EPAccountFormField
        name="username"
        label="Username"
        inputType={usernameType}
      />
      {showPassword ? (
        <EPAccountFormField
          name="password"
          label="Password"
          inputType="password"
          required={passwordRequired}
        />
      ) : null}
    </>
  );
}

describe("EPAccountFormField", () => {
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
    ref = React.createRef<LoginActions>()
  ) {
    const view = render(
      <EPAccountProvider>
        <EPAccountLoginFormProvider ref={ref}>{fields}</EPAccountLoginFormProvider>
      </EPAccountProvider>
    );
    return { ...view, ref };
  }

  it("renders text, email, and masked password inputs", () => {
    const view = renderFields(<Fields />);
    const username = screen.getByLabelText("Username *") as HTMLInputElement;
    const password = screen.getByLabelText("Password *") as HTMLInputElement;
    expect(username.type).toBe("text");
    expect(username.getAttribute("autocomplete")).toBe("username");
    expect(password.type).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");

    view.rerender(
      <EPAccountProvider>
        <EPAccountLoginFormProvider ref={view.ref}>
          <Fields usernameType="email" />
        </EPAccountLoginFormProvider>
      </EPAccountProvider>
    );
    const email = screen.getByLabelText("Username *") as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(
      (screen.getByLabelText("Password *") as HTMLInputElement).type
    ).toBe("password");
  });

  it("writes values only through the login form context", () => {
    renderFields(<Fields />);
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password *"), {
      target: { value: "secret" },
    });
    expect(
      (screen.getByLabelText("Username *") as HTMLInputElement).value
    ).toBe("buyer@example.com");
    expect(
      (screen.getByLabelText("Password *") as HTMLInputElement).value
    ).toBe("secret");
  });

  it("renders required errors from the form and does not sign in", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields />);
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer@example.com" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(loginCalls(fetchImpl)).toEqual([]);
    expect(screen.queryByText("This field is required")).toBeTruthy();
    expect(
      screen.getByLabelText("Password *").getAttribute("aria-invalid")
    ).toBe("true");
    expect(
      screen.getByLabelText("Username *").getAttribute("aria-invalid")
    ).toBeNull();
    expect(
      screen.getByLabelText("Password *").parentElement?.querySelector(
        "[data-ep-field-error]"
      )?.textContent
    ).toBe("This field is required");
  });

  it("does not require a field registered as optional", async () => {
    const fetchImpl = installFetch();
    const { ref } = renderFields(<Fields passwordRequired={false} />);
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer@example.com" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(loginCalls(fetchImpl)).toHaveLength(1);
    expect(screen.queryByText("This field is required")).toBeNull();
    expect(JSON.parse(String(loginCalls(fetchImpl)[0][1]?.body))).toEqual({
      username: "buyer@example.com",
      password: "",
    });
  });

  it("unregisters a field so it is no longer required", async () => {
    const fetchImpl = installFetch();
    const ref = React.createRef<LoginActions>();
    const tree = (showPassword: boolean) => (
      <EPAccountProvider>
        <EPAccountLoginFormProvider ref={ref}>
          <Fields showPassword={showPassword} />
        </EPAccountLoginFormProvider>
      </EPAccountProvider>
    );
    const { rerender } = render(tree(true));
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer@example.com" },
    });
    await act(async () => {
      await ref.current!.submit();
    });
    expect(loginCalls(fetchImpl)).toEqual([]);

    rerender(tree(false));
    expect(screen.queryByLabelText("Password *")).toBeNull();
    await act(async () => {
      await ref.current!.submit();
    });
    expect(loginCalls(fetchImpl)).toHaveLength(1);
    expect(JSON.parse(String(loginCalls(fetchImpl)[0][1]?.body))).toEqual({
      username: "buyer@example.com",
      password: "",
    });
  });

  it("does not publish credentials through a data provider", () => {
    renderFields(<Fields />);
    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password *"), {
      target: { value: "secret" },
    });
    const published = screen
      .getAllByTestId(/data-provider-/)
      .map((node) => node.getAttribute("data-value") ?? "");
    expect(published.length).toBeGreaterThan(0);
    for (const raw of published) {
      expect(raw).not.toMatch(/buyer@example.com/);
      expect(raw).not.toMatch(/secret/);
    }
  });

  it("registers the field with name, label, input type, and required only", () => {
    expect(epAccountFormFieldMeta.name).toBe(
      "plasmic-commerce-ep-account-form-field"
    );
    expect(epAccountFormFieldMeta.displayName).toBe("EP Account Form Field");
    expect(epAccountFormFieldMeta.importName).toBe("EPAccountFormField");
    expect(epAccountFormFieldMeta.importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path"
    );
    expect(epAccountFormFieldMeta.parentComponentName).toBe(
      "plasmic-commerce-ep-account-login-form-provider"
    );
    expect(epAccountFormFieldMeta.providesData).toBeFalsy();
    expect(epAccountFormFieldMeta.refActions).toBeUndefined();
    expect(Object.keys(epAccountFormFieldMeta.props ?? {})).toEqual([
      "name",
      "label",
      "inputType",
      "required",
    ]);
    const props = epAccountFormFieldMeta.props as any;
    expect(props.name.options).toEqual(["username", "password"]);
    expect(props.inputType.options).toEqual(["text", "email", "password"]);
    const loader = { registerComponent: jest.fn() };
    registerEPAccountFormField(loader);
    expect(loader.registerComponent).toHaveBeenCalledWith(
      EPAccountFormField,
      epAccountFormFieldMeta
    );
  });
});
