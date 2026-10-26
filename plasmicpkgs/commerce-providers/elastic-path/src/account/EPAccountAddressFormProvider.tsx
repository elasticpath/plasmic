/** EPAccountAddressFormProvider — creates one saved address. */

import {
  DataProvider,
  usePlasmicCanvasContext,
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
import { epIdentityErrorCode } from "../identity/client";
import type { EpAccountAddressCreateRequest } from "../identity/operations";
import { useEpIdentity } from "../identity/useEpIdentity";
import { Registerable } from "../registerable";
import { useAccountAddressBookRefresh } from "./EPAccountAddressProvider";
import type { AccountAddressFieldName } from "./types";

const ADDRESS_FIELDS: AccountAddressFieldName[] = [
  "name",
  "first_name",
  "last_name",
  "company_name",
  "phone_number",
  "instructions",
  "line_1",
  "line_2",
  "city",
  "county",
  "region",
  "postcode",
  "country",
];

/** Default slot only. Runtime validation uses each mounted field's `required` prop. */
const DEFAULT_ADDRESS_FORM_FIELDS: {
  name: AccountAddressFieldName;
  label: string;
  required: boolean;
}[] = [
  { name: "first_name", label: "First Name", required: true },
  { name: "last_name", label: "Last Name", required: true },
  { name: "line_1", label: "Line 1", required: true },
  { name: "city", label: "City", required: false },
  { name: "county", label: "County", required: true },
  { name: "postcode", label: "Postcode", required: true },
  { name: "country", label: "Country", required: true },
];

type AddressStatus = "idle" | "submitting" | "submitted" | "error";

export type AccountAddressFormError = {
  code: string;
  message: string;
};

export interface AccountAddressFormContextValue {
  values: Record<AccountAddressFieldName, string>;
  errors: Record<AccountAddressFieldName, string | null>;
  status: AddressStatus;
  error: AccountAddressFormError | null;
  setField(name: AccountAddressFieldName, value: string): void;
  registerField(name: AccountAddressFieldName, opts: { required?: boolean }): void;
  unregisterField(name: AccountAddressFieldName): void;
  submit(): Promise<void>;
}

const EMPTY_VALUES = Object.fromEntries(
  ADDRESS_FIELDS.map((field) => [field, ""])
) as Record<AccountAddressFieldName, string>;

const EMPTY_ERRORS = Object.fromEntries(
  ADDRESS_FIELDS.map((field) => [field, null])
) as Record<AccountAddressFieldName, string | null>;

const ENTER_ADDRESS: AccountAddressFormError = {
  code: "invalid_input",
  message: "Enter an address.",
};

const REQUIRED_FIELD = "This field is required.";

const REQUIRED_FORM: AccountAddressFormError = {
  code: "invalid_input",
  message: "Please complete the required fields.",
};

const CREATE_FAILED: AccountAddressFormError = {
  code: "account_address_create_failed",
  message: "Elastic Path rejected the account-address create.",
};

const REFRESH_FAILED: AccountAddressFormError = {
  code: "account_addresses_refresh_failed",
  message:
    "The saved address was created, but the address list could not be refreshed.",
};

const NOOP_FORM: AccountAddressFormContextValue = {
  values: EMPTY_VALUES,
  errors: EMPTY_ERRORS,
  status: "idle",
  error: null,
  setField: () => {},
  registerField: () => {},
  unregisterField: () => {},
  submit: async () => {},
};

export const AccountAddressFormContext =
  React.createContext<AccountAddressFormContextValue>(NOOP_FORM);

export function useAccountAddressForm(): AccountAddressFormContextValue {
  return useContext(AccountAddressFormContext);
}

interface EPAccountAddressFormProviderProps {
  children?: React.ReactNode;
  className?: string;
}

interface EPAccountAddressFormProviderActions {
  submit(): Promise<void>;
}

function createFailure(err: unknown): AccountAddressFormError {
  const code = epIdentityErrorCode(err) ?? CREATE_FAILED.code;
  const message =
    err instanceof Error && err.message ? err.message : CREATE_FAILED.message;
  return { code, message };
}

export const EPAccountAddressFormProvider = React.forwardRef<
  EPAccountAddressFormProviderActions,
  EPAccountAddressFormProviderProps
>(function EPAccountAddressFormProvider(props, ref) {
  const { children, className } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const identity = useEpIdentity();
  const refreshBook = useAccountAddressBookRefresh();
  const [drafts, setDrafts] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [status, setStatus] = useState<AddressStatus>("idle");
  const [error, setError] = useState<AccountAddressFormError | null>(null);
  const submittingRef = useRef(false);
  const registry = useRef<
    Map<AccountAddressFieldName, { required: boolean }>
  >(new Map());

  const registerField = useCallback(
    (name: AccountAddressFieldName, opts: { required?: boolean }) => {
      registry.current.set(name, { required: !!opts.required });
    },
    []
  );

  const unregisterField = useCallback((name: AccountAddressFieldName) => {
    registry.current.delete(name);
  }, []);

  const setField = useCallback(
    (name: AccountAddressFieldName, value: string) => {
      setDrafts((prev) => ({ ...prev, [name]: value }));
      setErrors((prev) => (prev[name] ? { ...prev, [name]: null } : prev));
      setError((prev) => (prev ? null : prev));
    },
    []
  );

  const submit = useCallback(async () => {
    if (inEditor) return;
    if (submittingRef.current) return;

    const nextErrors = { ...EMPTY_ERRORS };
    let missing = false;
    registry.current.forEach((reg, field) => {
      if (!reg.required) return;
      if (!drafts[field].trim()) {
        nextErrors[field] = REQUIRED_FIELD;
        missing = true;
      }
    });
    if (missing) {
      setErrors(nextErrors);
      setStatus("error");
      setError(REQUIRED_FORM);
      return;
    }

    const request: EpAccountAddressCreateRequest = {};
    for (const field of ADDRESS_FIELDS) {
      const value = drafts[field].trim();
      if (!value) continue;
      request[field] = value;
    }
    if (Object.keys(request).length === 0) {
      setErrors(EMPTY_ERRORS);
      setStatus("error");
      setError(ENTER_ADDRESS);
      return;
    }

    submittingRef.current = true;
    setStatus("submitting");
    setError(null);
    setErrors(EMPTY_ERRORS);
    try {
      await identity.createAccountAddress(request);
    } catch (err) {
      setStatus("error");
      setError(createFailure(err));
      submittingRef.current = false;
      return;
    }
    setDrafts({ ...EMPTY_VALUES });
    try {
      await refreshBook();
      setStatus("submitted");
    } catch {
      setStatus("submitted");
      setError(REFRESH_FAILED);
    } finally {
      submittingRef.current = false;
    }
  }, [inEditor, drafts, identity, refreshBook]);

  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const form = React.useMemo<AccountAddressFormContextValue>(
    () => ({
      values: drafts,
      errors,
      status,
      error,
      setField,
      registerField,
      unregisterField,
      submit,
    }),
    [drafts, errors, status, error, setField, registerField, unregisterField, submit]
  );

  const accountAddressFormData = React.useMemo(
    () => ({
      status,
      error,
      isSubmitting: status === "submitting",
    }),
    [status, error]
  );

  return (
    <AccountAddressFormContext.Provider value={form}>
      <DataProvider name="accountAddressFormData" data={accountAddressFormData}>
        <div className={className} data-ep-account-address-form="">
          {children}
        </div>
      </DataProvider>
    </AccountAddressFormContext.Provider>
  );
});

export const epAccountAddressFormProviderMeta: CodeComponentMeta<EPAccountAddressFormProviderProps> =
  {
    name: "plasmic-commerce-ep-account-address-form-provider",
    displayName: "EP Account Address Form Provider",
    description:
      "Creates a saved address for the selected organisation, then refreshes the surrounding EP Account Address Provider. Wire a button to the Submit action. Submit is blocked only by mounted fields whose Required prop is on. Sends only non-empty trimmed address fields. Does not publish the field values.",
    props: {
      children: {
        type: "slot",
        defaultValue: DEFAULT_ADDRESS_FORM_FIELDS.map((field) => ({
          type: "component" as const,
          name: "plasmic-commerce-ep-account-address-form-field",
          props: field,
        })),
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountAddressFormProvider",
    parentComponentName: "plasmic-commerce-ep-account-address-provider",
    refActions: {
      submit: {
        displayName: "Submit",
        description:
          "Create the saved address, then refresh the address book. No-op in the Studio canvas. Does nothing while a mounted field with Required turned on is blank.",
        argTypes: [],
      },
    },
  };

export function registerEPAccountAddressFormProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountAddressFormProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountAddressFormProvider,
    customMeta ?? epAccountAddressFormProviderMeta
  );
}
