/**
 * EPAccountLoginFormProvider — collects credentials and signs the shopper in.
 *
 * Owns the login form state and calls `useEpIdentity().login`. After success
 * it asks the surrounding Account Provider to reload.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  useCallback,
  useContext,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useEpIdentity } from "../identity/useEpIdentity";
import { Registerable } from "../registerable";
import { useAccountReload } from "./EPAccountProvider";

type LoginField = "username" | "password";
type LoginStatus = "idle" | "submitting" | "submitted" | "error";

export interface AccountLoginFormContextValue {
  values: Record<LoginField, string>;
  errors: Record<LoginField, string | null>;
  status: LoginStatus;
  error: string | null;
  setField(name: LoginField, value: string): void;
  registerField(name: LoginField, opts: { required?: boolean }): void;
  unregisterField(name: LoginField): void;
  submit(): Promise<void>;
}

const EMPTY_VALUES: Record<LoginField, string> = {
  username: "",
  password: "",
};

const EMPTY_ERRORS: Record<LoginField, string | null> = {
  username: null,
  password: null,
};

const NOOP_FORM: AccountLoginFormContextValue = {
  values: EMPTY_VALUES,
  errors: EMPTY_ERRORS,
  status: "idle",
  error: null,
  setField: () => {},
  registerField: () => {},
  unregisterField: () => {},
  submit: async () => {},
};

export const AccountLoginFormContext =
  React.createContext<AccountLoginFormContextValue>(NOOP_FORM);

export function useAccountLoginForm(): AccountLoginFormContextValue {
  return useContext(AccountLoginFormContext);
}

interface EPAccountLoginFormProviderProps {
  children?: React.ReactNode;
  className?: string;
}

interface EPAccountLoginFormProviderActions {
  submit(): Promise<void>;
}

const REQUIRED = "This field is required";
const REQUIRED_FORM = "Please complete the required fields.";
const REFRESH_FAILED =
  "Signed in, but the account could not be refreshed.";

function loginFailureMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Sign in failed. Please try again.";
}

export const EPAccountLoginFormProvider = React.forwardRef<
  EPAccountLoginFormProviderActions,
  EPAccountLoginFormProviderProps
>(function EPAccountLoginFormProvider(props, ref) {
  const { children, className } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const identity = useEpIdentity();
  const reloadAccount = useAccountReload();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const registry = useRef<Map<LoginField, { required: boolean }>>(new Map());

  const registerField = useCallback(
    (name: LoginField, opts: { required?: boolean }) => {
      registry.current.set(name, { required: !!opts.required });
    },
    []
  );

  const unregisterField = useCallback((name: LoginField) => {
    registry.current.delete(name);
  }, []);

  const setField = useCallback((name: LoginField, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: null } : prev));
  }, []);

  const submit = useCallback(async () => {
    if (inEditor) return;
    const username = values.username.trim();
    const password = values.password;
    const nextErrors: Record<LoginField, string | null> = {
      username: null,
      password: null,
    };
    let missing = false;
    registry.current.forEach((reg, name) => {
      if (!reg.required) return;
      const raw = name === "username" ? username : password;
      if (raw.length === 0) {
        missing = true;
        nextErrors[name] = REQUIRED;
      }
    });
    if (missing) {
      setErrors(nextErrors);
      setStatus("error");
      setError(REQUIRED_FORM);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setStatus("submitting");
    setError(null);
    setErrors(EMPTY_ERRORS);
    try {
      await identity.login({ username, password });
    } catch (err) {
      setStatus("error");
      setError(loginFailureMessage(err));
      submittingRef.current = false;
      return;
    }
    try {
      await reloadAccount();
      setStatus("submitted");
    } catch {
      setStatus("submitted");
      setError(REFRESH_FAILED);
    } finally {
      submittingRef.current = false;
    }
  }, [inEditor, values, identity, reloadAccount]);

  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const form = React.useMemo<AccountLoginFormContextValue>(
    () => ({
      values,
      errors,
      status,
      error,
      setField,
      registerField,
      unregisterField,
      submit,
    }),
    [values, errors, status, error, setField, registerField, unregisterField, submit]
  );

  const accountLoginFormData = React.useMemo(
    () => ({
      status,
      error,
      isSubmitting: status === "submitting",
    }),
    [status, error]
  );

  return (
    <AccountLoginFormContext.Provider value={form}>
      <DataProvider name="accountLoginFormData" data={accountLoginFormData}>
        <div className={className} data-ep-account-login-form="">
          {children}
        </div>
      </DataProvider>
    </AccountLoginFormContext.Provider>
  );
});

export const epAccountLoginFormProviderMeta: CodeComponentMeta<EPAccountLoginFormProviderProps> =
  {
    name: "plasmic-commerce-ep-account-login-form-provider",
    displayName: "EP Account Login Form Provider",
    description:
      "Signs the shopper in with username and password, then reloads the surrounding EP Account Provider. Wire a button to the Submit action. Does not publish the credentials.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-form-field",
            props: {
              name: "username",
              label: "Username",
              inputType: "text",
              required: true,
            },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-account-form-field",
            props: {
              name: "password",
              label: "Password",
              inputType: "password",
              required: true,
            },
          },
        ],
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountLoginFormProvider",
    parentComponentName: "plasmic-commerce-ep-account-provider",
    refActions: {
      submit: {
        displayName: "Submit",
        description:
          "Sign in with the collected username and password. No-op in the Studio canvas.",
        argTypes: [],
      },
    },
  };

export function registerEPAccountLoginFormProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountLoginFormProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountLoginFormProvider,
    customMeta ?? epAccountLoginFormProviderMeta
  );
}
