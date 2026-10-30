/** EPAccountAddressFormProvider — creates or edits one saved address. */

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
import { epIdentityErrorCode } from "../identity/client";
import type {
  EpAccountAddress,
  EpAccountAddressCreateRequest,
  EpAccountAddressUpdateRequest,
} from "../identity/operations";
import { useEpIdentity } from "../identity/useEpIdentity";
import { Registerable } from "../registerable";
import { useCanvasPreviewState } from "../utils/canvas-preview-state";
import { MOCK_ACCOUNT_ADDRESSES } from "../utils/design-time-data";
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
  registerField(
    instanceId: string,
    opts: { name: AccountAddressFieldName; required?: boolean }
  ): void;
  unregisterField(instanceId: string): void;
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

const UPDATE_FAILED: AccountAddressFormError = {
  code: "account_address_update_failed",
  message: "Elastic Path rejected the account-address update.",
};

const UPDATE_REFRESH_FAILED: AccountAddressFormError = {
  code: "account_addresses_refresh_failed",
  message:
    "The saved address was updated, but the address list could not be refreshed.",
};

type AddressFormMode = "create" | "edit";

type AddressFormPreviewState =
  | "auto"
  | "idle"
  | "submitting"
  | "submitted"
  | "error";

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
  mode?: AddressFormMode;
  previewState?: AddressFormPreviewState;
}

function seedValues(
  address: EpAccountAddress | undefined
): Record<AccountAddressFieldName, string> {
  const next = { ...EMPTY_VALUES };
  if (!address) return next;
  for (const field of ADDRESS_FIELDS) {
    const value = address[field];
    if (typeof value === "string") next[field] = value;
  }
  return next;
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

function updateFailure(err: unknown): AccountAddressFormError {
  const code = epIdentityErrorCode(err) ?? UPDATE_FAILED.code;
  const message =
    err instanceof Error && err.message ? err.message : UPDATE_FAILED.message;
  return { code, message };
}

export const EPAccountAddressFormProvider = React.forwardRef<
  EPAccountAddressFormProviderActions,
  EPAccountAddressFormProviderProps
>(function EPAccountAddressFormProvider(props, ref) {
  const { children, className, mode = "create", previewState } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const preview = useCanvasPreviewState(previewState);
  const current = useSelector("currentAccountAddress") as
    | EpAccountAddress
    | undefined;
  const identity = useEpIdentity();
  const refreshBook = useAccountAddressBookRefresh();
  const [drafts, setDrafts] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [status, setStatus] = useState<AddressStatus>("idle");
  const [error, setError] = useState<AccountAddressFormError | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const sessionIdRef = useRef<string | null>(null);
  const sessionGenerationRef = useRef(0);
  const baselineRef = useRef(EMPTY_VALUES);
  const [sessionTargetId, setSessionTargetId] = useState<string | null>(null);
  const registry = useRef<
    Map<string, { name: AccountAddressFieldName; required: boolean }>
  >(new Map());
  const currentAddress =
    inEditor && mode === "edit"
      ? current ?? MOCK_ACCOUNT_ADDRESSES[0]
      : current;
  const currentAddressId =
    currentAddress &&
    typeof currentAddress.id === "string" &&
    currentAddress.id
      ? currentAddress.id
      : null;
  const editTargetId = mode === "edit" ? currentAddressId : null;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (mode === "edit" && sessionTargetId !== currentAddressId) {
    const seeded = seedValues(currentAddressId ? currentAddress : undefined);
    setSessionTargetId(currentAddressId);
    setDrafts(seeded);
    setErrors(EMPTY_ERRORS);
    setStatus("idle");
    setError(null);
  }

  React.useLayoutEffect(() => {
    if (mode !== "edit") return;
    if (sessionIdRef.current === currentAddressId) return;
    sessionIdRef.current = currentAddressId;
    sessionGenerationRef.current += 1;
    submittingRef.current = false;
    baselineRef.current = seedValues(currentAddressId ? currentAddress : undefined);
  }, [mode, currentAddressId, currentAddress]);

  const registerField = useCallback(
    (
      instanceId: string,
      opts: { name: AccountAddressFieldName; required?: boolean }
    ) => {
      registry.current.set(instanceId, {
        name: opts.name,
        required: !!opts.required,
      });
    },
    []
  );

  const unregisterField = useCallback((instanceId: string) => {
    registry.current.delete(instanceId);
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

    if (mode === "edit") {
      if (!editTargetId) return;

      const nextErrors = { ...EMPTY_ERRORS };
      const requiredNames = new Set<AccountAddressFieldName>();
      registry.current.forEach((reg) => {
        if (reg.required) requiredNames.add(reg.name);
      });
      let missing = false;
      requiredNames.forEach((field) => {
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

      const request: EpAccountAddressUpdateRequest = { id: editTargetId };
      const mountedNames = new Set<AccountAddressFieldName>();
      registry.current.forEach((reg) => mountedNames.add(reg.name));
      mountedNames.forEach((field) => {
        const submitted = drafts[field].trim();
        if (submitted !== baselineRef.current[field].trim()) {
          request[field] = submitted;
        }
      });
      if (Object.keys(request).length === 1) {
        setErrors(EMPTY_ERRORS);
        setError(null);
        if (status === "error") setStatus("idle");
        return;
      }

      const capturedId = editTargetId;
      const capturedGeneration = sessionGenerationRef.current;
      const submittedDrafts = { ...drafts };
      submittingRef.current = true;
      setStatus("submitting");
      setError(null);
      setErrors(EMPTY_ERRORS);
      const still = () =>
        mountedRef.current &&
        sessionIdRef.current === capturedId &&
        sessionGenerationRef.current === capturedGeneration;
      try {
        await identity.updateAccountAddress(request);
      } catch (err) {
        if (!still()) return;
        setStatus("error");
        setError(updateFailure(err));
        submittingRef.current = false;
        return;
      }
      if (still()) {
        baselineRef.current = submittedDrafts;
      }
      try {
        await refreshBook();
      } catch {
        if (!still()) return;
        setStatus("submitted");
        setError(UPDATE_REFRESH_FAILED);
        submittingRef.current = false;
        return;
      }
      if (!still()) return;
      setStatus("submitted");
      submittingRef.current = false;
      return;
    }

    const nextErrors = { ...EMPTY_ERRORS };
    const requiredNames = new Set<AccountAddressFieldName>();
    registry.current.forEach((reg) => {
      if (reg.required) requiredNames.add(reg.name);
    });
    let missing = false;
    requiredNames.forEach((field) => {
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
  }, [inEditor, mode, editTargetId, drafts, status, identity, refreshBook]);

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

  const canvasEditPreview =
    inEditor && mode === "edit" && preview !== "auto" && preview !== "idle";
  const publishedStatus: AddressStatus = canvasEditPreview
    ? preview === "submitting"
      ? "submitting"
      : preview === "submitted"
        ? "submitted"
        : "error"
    : status;
  const publishedError = canvasEditPreview
    ? preview === "error"
      ? UPDATE_FAILED
      : null
    : error;
  const accountAddressFormData = React.useMemo(
    () => ({
      status: publishedStatus,
      error: publishedError,
      isSubmitting: publishedStatus === "submitting",
    }),
    [publishedStatus, publishedError]
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
      "Creates or edits one saved address for the selected organisation, then refreshes the surrounding EP Account Address Provider. Mode defaults to create. Edit shows the current saved address and sends only fields that differ from it, including an empty string when a field is cleared. Edit submit does nothing when no current address is published, including after that address is deleted. Wire a button to the Submit action. Submit is blocked only by mounted fields whose Required prop is on. Does not publish the field values.",
    props: {
      children: {
        type: "slot",
        defaultValue: DEFAULT_ADDRESS_FORM_FIELDS.map((field) => ({
          type: "component" as const,
          name: "plasmic-commerce-ep-account-address-form-field",
          props: field,
        })),
      },
      mode: {
        type: "choice",
        options: [
          { label: "Create", value: "create" },
          { label: "Edit", value: "edit" },
        ],
        defaultValue: "create",
        displayName: "Mode",
      },
      previewState: {
        type: "choice",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Idle", value: "idle" },
          { label: "Submitting", value: "submitting" },
          { label: "Submitted", value: "submitted" },
          { label: "Error", value: "error" },
        ],
        defaultValue: "auto",
        displayName: "Preview State",
        advanced: true,
        description:
          "Studio only, for edit mode. Auto and idle show a sample saved address. The other values force that form state on the canvas. The canvas does not update a saved address. Published pages ignore this.",
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
          "Create or update the saved address, then refresh the address book. Edit sends only fields that differ from the saved address. No-op in the Studio canvas, no-op in edit mode when nothing changed, and no-op in edit mode when there is no current address. Does nothing while a mounted field with Required turned on is blank.",
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
