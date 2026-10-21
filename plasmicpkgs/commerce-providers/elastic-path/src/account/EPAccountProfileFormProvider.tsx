/**
 * EPAccountProfileFormProvider — edits the signed-in member's name and email.
 *
 * Owns the field drafts and calls `useEpIdentity().updateMember` with only
 * the fields the shopper changed. After a successful write it asks the
 * surrounding Account Provider to reload, which reads the account member.
 */

import {
  DataProvider,
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
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
import type { AccountContext } from "./types";

type ProfileField = "name" | "email";
type ProfileStatus = "idle" | "submitting" | "submitted" | "error";

export interface AccountProfileFormContextValue {
  values: Record<ProfileField, string>;
  errors: Record<ProfileField, string | null>;
  status: ProfileStatus;
  error: string | null;
  setField(name: ProfileField, value: string): void;
  submit(): Promise<void>;
}

const EMPTY_VALUES: Record<ProfileField, string> = { name: "", email: "" };
const EMPTY_ERRORS: Record<ProfileField, string | null> = {
  name: null,
  email: null,
};

const NOOP_FORM: AccountProfileFormContextValue = {
  values: EMPTY_VALUES,
  errors: EMPTY_ERRORS,
  status: "idle",
  error: null,
  setField: () => {},
  submit: async () => {},
};

export const AccountProfileFormContext =
  React.createContext<AccountProfileFormContextValue>(NOOP_FORM);

export function useAccountProfileForm(): AccountProfileFormContextValue {
  return useContext(AccountProfileFormContext);
}

interface EPAccountProfileFormProviderProps {
  children?: React.ReactNode;
  className?: string;
}

interface EPAccountProfileFormProviderActions {
  submit(): Promise<void>;
}

const REQUIRED = "This field is required";
const REQUIRED_FORM = "Please complete the required fields.";
const INVALID_EMAIL = "Enter a valid email address.";
const REFRESH_FAILED = "Updated, but the account could not be refreshed.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function profileFailureMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Profile update failed. Please try again.";
}

function seededProfile(account: AccountContext | undefined): Record<
  ProfileField,
  string
> {
  return {
    name: account?.accountMember?.name ?? "",
    email: account?.accountMember?.email ?? "",
  };
}

export const EPAccountProfileFormProvider = React.forwardRef<
  EPAccountProfileFormProviderActions,
  EPAccountProfileFormProviderProps
>(function EPAccountProfileFormProvider(props, ref) {
  const { children, className } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const identity = useEpIdentity();
  const reloadAccount = useAccountReload();
  const account = useSelector("account") as AccountContext | undefined;
  const baseline = seededProfile(account);
  const [drafts, setDrafts] = useState<Partial<Record<ProfileField, string>>>(
    {}
  );
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [status, setStatus] = useState<ProfileStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const values: Record<ProfileField, string> = {
    name: drafts.name !== undefined ? drafts.name : baseline.name,
    email: drafts.email !== undefined ? drafts.email : baseline.email,
  };

  const setField = useCallback((name: ProfileField, value: string) => {
    setDrafts((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: null } : prev));
  }, []);

  const submit = useCallback(async () => {
    if (inEditor) return;
    if (submittingRef.current) return;

    const nextErrors: Record<ProfileField, string | null> = {
      name: null,
      email: null,
    };
    const payload: { name?: string; email?: string } = {};
    let missing = false;
    if (drafts.name !== undefined) {
      const name = drafts.name.trim();
      if (!name) {
        missing = true;
        nextErrors.name = REQUIRED;
      }
    }
    if (drafts.email !== undefined) {
      const email = drafts.email.trim();
      if (!email) {
        missing = true;
        nextErrors.email = REQUIRED;
      }
    }
    if (missing) {
      setErrors(nextErrors);
      setStatus("error");
      setError(REQUIRED_FORM);
      return;
    }
    if (
      drafts.email !== undefined &&
      !EMAIL_RE.test(drafts.email.trim())
    ) {
      nextErrors.email = INVALID_EMAIL;
      setErrors(nextErrors);
      setStatus("error");
      setError(INVALID_EMAIL);
      return;
    }
    if (drafts.name !== undefined) {
      const name = drafts.name.trim();
      if (name !== baselineRef.current.name.trim()) {
        payload.name = name;
      }
    }
    if (drafts.email !== undefined) {
      const email = drafts.email.trim();
      if (email !== baselineRef.current.email.trim()) {
        payload.email = email;
      }
    }
    if (payload.name === undefined && payload.email === undefined) {
      setErrors(EMPTY_ERRORS);
      setStatus("idle");
      setError(null);
      return;
    }

    submittingRef.current = true;
    setStatus("submitting");
    setError(null);
    setErrors(EMPTY_ERRORS);
    const request =
      payload.name !== undefined && payload.email !== undefined
        ? { name: payload.name, email: payload.email }
        : payload.name !== undefined
          ? { name: payload.name }
          : { email: payload.email! };
    try {
      await identity.updateMember(request);
    } catch (err) {
      setStatus("error");
      setError(profileFailureMessage(err));
      submittingRef.current = false;
      return;
    }
    try {
      await reloadAccount();
      setDrafts({});
      setStatus("submitted");
    } catch {
      setStatus("submitted");
      setError(REFRESH_FAILED);
    } finally {
      submittingRef.current = false;
    }
  }, [inEditor, drafts, identity, reloadAccount]);

  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const form = React.useMemo<AccountProfileFormContextValue>(
    () => ({
      values,
      errors,
      status,
      error,
      setField,
      submit,
    }),
    [values, errors, status, error, setField, submit]
  );

  const accountProfileFormData = React.useMemo(
    () => ({
      status,
      error,
      isSubmitting: status === "submitting",
    }),
    [status, error]
  );

  return (
    <AccountProfileFormContext.Provider value={form}>
      <DataProvider name="accountProfileFormData" data={accountProfileFormData}>
        <div className={className} data-ep-account-profile-form="">
          {children}
        </div>
      </DataProvider>
    </AccountProfileFormContext.Provider>
  );
});

export const epAccountProfileFormProviderMeta: CodeComponentMeta<EPAccountProfileFormProviderProps> =
  {
    name: "plasmic-commerce-ep-account-profile-form-provider",
    displayName: "EP Account Profile Form Provider",
    description:
      "Edits the signed-in account member's name and email, then reloads the surrounding EP Account Provider. Wire a button to the Submit action. Sends only fields the shopper changed. Does not publish the field values.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-profile-field",
            props: { name: "name", label: "Name" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-account-profile-field",
            props: { name: "email", label: "Email" },
          },
        ],
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountProfileFormProvider",
    parentComponentName: "plasmic-commerce-ep-account-provider",
    refActions: {
      submit: {
        displayName: "Submit",
        description:
          "Save the changed name and email, then reload account identity. No-op in the Studio canvas. Does nothing when no field changed.",
        argTypes: [],
      },
    },
  };

export function registerEPAccountProfileFormProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountProfileFormProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountProfileFormProvider,
    customMeta ?? epAccountProfileFormProviderMeta
  );
}
