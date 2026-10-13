/**
 * EPAccountRegistrationFormProvider — collects a registration and signs the
 * shopper up.
 *
 * Owns the registration form state and calls `useEpIdentity().register`.
 * After success it ignores that result and asks the surrounding Account
 * Provider to reload. When that reload fulfills, a valid `?redirect=` or
 * `redirectUrl` navigates away.
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
import { assignReturnTo, readLocationSearch, resolveReturnTo } from "./return-to";

type RegistrationField =
  | "name"
  | "email"
  | "username"
  | "password"
  | "confirmPassword";
type RegistrationStatus = "idle" | "submitting" | "submitted" | "error";

export interface AccountRegistrationFormContextValue {
  values: Record<RegistrationField, string>;
  errors: Record<RegistrationField, string | null>;
  status: RegistrationStatus;
  error: string | null;
  setField(name: RegistrationField, value: string): void;
  registerField(name: RegistrationField): void;
  unregisterField(name: RegistrationField): void;
  submit(): Promise<void>;
}

const EMPTY_VALUES: Record<RegistrationField, string> = {
  name: "",
  email: "",
  username: "",
  password: "",
  confirmPassword: "",
};

const EMPTY_ERRORS: Record<RegistrationField, string | null> = {
  name: null,
  email: null,
  username: null,
  password: null,
  confirmPassword: null,
};

const NOOP_FORM: AccountRegistrationFormContextValue = {
  values: EMPTY_VALUES,
  errors: EMPTY_ERRORS,
  status: "idle",
  error: null,
  setField: () => {},
  registerField: () => {},
  unregisterField: () => {},
  submit: async () => {},
};

export const AccountRegistrationFormContext =
  React.createContext<AccountRegistrationFormContextValue>(NOOP_FORM);

export function useAccountRegistrationForm(): AccountRegistrationFormContextValue {
  return useContext(AccountRegistrationFormContext);
}

interface EPAccountRegistrationFormProviderProps {
  children?: React.ReactNode;
  className?: string;
  redirectUrl?: string;
}

interface EPAccountRegistrationFormProviderActions {
  submit(): Promise<void>;
}

const REQUIRED = "This field is required";
const REQUIRED_FORM = "Please complete the required fields.";
const INVALID_EMAIL = "Enter a valid email address.";
const PASSWORDS_MISMATCH = "Passwords do not match.";
const REFRESH_FAILED =
  "Registered, but the account could not be refreshed.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function registrationFailureMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Registration failed. Please try again.";
}

function validateRegistration(
  values: Record<RegistrationField, string>,
  present: { username: boolean; confirmPassword: boolean }
): { errors: Record<RegistrationField, string | null>; formError: string } | null {
  const name = values.name.trim();
  const email = values.email.trim();
  const password = values.password;
  const username = values.username.trim();
  const confirmPassword = values.confirmPassword;
  const nextErrors: Record<RegistrationField, string | null> = {
    ...EMPTY_ERRORS,
  };
  let missing = false;
  if (name.length === 0) {
    missing = true;
    nextErrors.name = REQUIRED;
  }
  if (email.length === 0) {
    missing = true;
    nextErrors.email = REQUIRED;
  }
  if (password.length === 0) {
    missing = true;
    nextErrors.password = REQUIRED;
  }
  if (present.username && username.length === 0) {
    missing = true;
    nextErrors.username = REQUIRED;
  }
  if (present.confirmPassword && confirmPassword.length === 0) {
    missing = true;
    nextErrors.confirmPassword = REQUIRED;
  }
  if (missing) {
    return { errors: nextErrors, formError: REQUIRED_FORM };
  }
  if (!EMAIL_RE.test(email)) {
    nextErrors.email = INVALID_EMAIL;
    return { errors: nextErrors, formError: INVALID_EMAIL };
  }
  if (present.confirmPassword && confirmPassword !== password) {
    nextErrors.confirmPassword = PASSWORDS_MISMATCH;
    return { errors: nextErrors, formError: PASSWORDS_MISMATCH };
  }
  return null;
}

export const EPAccountRegistrationFormProvider = React.forwardRef<
  EPAccountRegistrationFormProviderActions,
  EPAccountRegistrationFormProviderProps
>(function EPAccountRegistrationFormProvider(props, ref) {
  const { children, className, redirectUrl } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const identity = useEpIdentity();
  const reloadAccount = useAccountReload();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [status, setStatus] = useState<RegistrationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const registry = useRef<Set<RegistrationField>>(new Set());

  const registerField = useCallback((name: RegistrationField) => {
    registry.current.add(name);
  }, []);

  const unregisterField = useCallback((name: RegistrationField) => {
    registry.current.delete(name);
  }, []);

  const setField = useCallback((name: RegistrationField, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: null } : prev));
  }, []);

  const submit = useCallback(async () => {
    if (inEditor) return;
    if (submittingRef.current) return;
    const usernamePresent = registry.current.has("username");
    const confirmPresent = registry.current.has("confirmPassword");
    const invalid = validateRegistration(values, {
      username: usernamePresent,
      confirmPassword: confirmPresent,
    });
    if (invalid) {
      setErrors(invalid.errors);
      setStatus("error");
      setError(invalid.formError);
      return;
    }
    submittingRef.current = true;
    setStatus("submitting");
    setError(null);
    setErrors(EMPTY_ERRORS);
    const email = values.email.trim();
    try {
      await identity.register({
        username: usernamePresent ? values.username.trim() : email,
        password: values.password,
        name: values.name.trim(),
        email,
      });
    } catch (err) {
      setStatus("error");
      setError(registrationFailureMessage(err));
      submittingRef.current = false;
      return;
    }
    try {
      await reloadAccount();
      setStatus("submitted");
      const target = resolveReturnTo({
        search: readLocationSearch(),
        configured: redirectUrl,
      });
      if (target) assignReturnTo(target);
    } catch {
      setStatus("submitted");
      setError(REFRESH_FAILED);
    } finally {
      submittingRef.current = false;
    }
  }, [inEditor, values, identity, reloadAccount, redirectUrl]);

  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const form = React.useMemo<AccountRegistrationFormContextValue>(
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
    [
      values,
      errors,
      status,
      error,
      setField,
      registerField,
      unregisterField,
      submit,
    ]
  );

  const accountRegistrationFormData = React.useMemo(
    () => ({
      status,
      error,
      isSubmitting: status === "submitting",
    }),
    [status, error]
  );

  return (
    <AccountRegistrationFormContext.Provider value={form}>
      <DataProvider
        name="accountRegistrationFormData"
        data={accountRegistrationFormData}
      >
        <div className={className} data-ep-account-registration-form="">
          {children}
        </div>
      </DataProvider>
    </AccountRegistrationFormContext.Provider>
  );
});

export const epAccountRegistrationFormProviderMeta: CodeComponentMeta<EPAccountRegistrationFormProviderProps> =
  {
    name: "plasmic-commerce-ep-account-registration-form-provider",
    displayName: "EP Account Registration Form Provider",
    description:
      "Registers an account member with name, email, and password, then reloads the surrounding EP Account Provider. After that reload succeeds, navigates to a valid ?redirect= on this page, or to Redirect URL. Wire a button to the Submit action. Does not publish the credentials.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-registration-field",
            props: { name: "name", label: "Name" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-account-registration-field",
            props: { name: "email", label: "Email" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-account-registration-field",
            props: { name: "password", label: "Password" },
          },
        ],
      },
      redirectUrl: {
        type: "string",
        displayName: "Redirect URL",
        description:
          "Optional same-site path to open after registration and a successful account reload, such as /account or /account?welcome=1. A fragment is allowed. A valid ?redirect= on this page overrides it. Invalid values are ignored, and an invalid query falls back to this path. Leave empty to stay on the page. No navigation when the reload fails, or in the Studio canvas.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountRegistrationFormProvider",
    parentComponentName: "plasmic-commerce-ep-account-provider",
    refActions: {
      submit: {
        displayName: "Submit",
        description:
          "Register with the collected name, email, and password, then follow a valid return-to redirect. No-op in the Studio canvas.",
        argTypes: [],
      },
    },
  };

export function registerEPAccountRegistrationFormProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountRegistrationFormProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountRegistrationFormProvider,
    customMeta ?? epAccountRegistrationFormProviderMeta
  );
}
