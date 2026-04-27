/**
 * EPCustomerInfoFields — headless provider for customer identity fields.
 *
 * Manages firstName, lastName, email with validation, touched tracking,
 * and pre-population from checkout context. Exposes `customerInfoFieldsData`
 * via DataProvider for designer binding.
 *
 * refActions: setField, validate, clear
 */
import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { Registerable } from "../../registerable";
import {
  MOCK_CUSTOMER_INFO_EMPTY,
  MOCK_CUSTOMER_INFO_FILLED,
  MOCK_CUSTOMER_INFO_WITH_ERRORS,
} from "../../utils/design-time-data";
import { createLogger } from "../../utils/logger";

const log = createLogger("EPCustomerInfoFields");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "empty" | "filled" | "withErrors";

interface CustomerInfoErrors {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

interface CustomerInfoTouched {
  firstName: boolean;
  lastName: boolean;
  email: boolean;
}

type FieldName = "firstName" | "lastName" | "email";

interface CustomerInfoFieldsData {
  firstName: string;
  lastName: string;
  email: string;
  errors: CustomerInfoErrors;
  touched: CustomerInfoTouched;
  isValid: boolean;
  isDirty: boolean;
}

interface EPCustomerInfoFieldsActions {
  setField(name: FieldName, value: string): void;
  validate(): boolean;
  clear(): void;
}

interface EPCustomerInfoFieldsProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateField(name: FieldName, value: string): string | null {
  switch (name) {
    case "firstName":
      return value.trim() ? null : "First name is required";
    case "lastName":
      return value.trim() ? null : "Last name is required";
    case "email":
      if (!value.trim()) return "Email is required";
      return EMAIL_RE.test(value.trim()) ? null : "Enter a valid email address";
    default:
      return null;
  }
}

function validateAll(
  values: { firstName: string; lastName: string; email: string }
): CustomerInfoErrors {
  return {
    firstName: validateField("firstName", values.firstName),
    lastName: validateField("lastName", values.lastName),
    email: validateField("email", values.email),
  };
}

// ---------------------------------------------------------------------------
// Mock map
// ---------------------------------------------------------------------------
const MOCK_MAP: Record<string, CustomerInfoFieldsData> = {
  empty: MOCK_CUSTOMER_INFO_EMPTY as CustomerInfoFieldsData,
  filled: MOCK_CUSTOMER_INFO_FILLED as CustomerInfoFieldsData,
  withErrors: MOCK_CUSTOMER_INFO_WITH_ERRORS as CustomerInfoFieldsData,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const EPCustomerInfoFields = React.forwardRef<
  EPCustomerInfoFieldsActions,
  EPCustomerInfoFieldsProps
>(function EPCustomerInfoFields(props, ref) {
  const { children, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // Pre-population priority:
  // 1. checkoutData.customerInfo (from EPCheckoutProvider — already split)
  // 2. checkoutSession.customerInfo (from EPCheckoutSessionProvider — name needs split)
  // 3. shopperContextData.account (from any ancestor DataProvider — name needs split)
  const checkoutData = useSelector("checkoutData") as
    | { customerInfo?: { firstName?: string; lastName?: string; email?: string } | null }
    | undefined;
  const checkoutSessionCtx = useSelector("checkoutSession") as
    | { session?: { customerInfo?: { name?: string; email?: string } } }
    | undefined;
  const shopperCtx = useSelector("shopperContextData") as
    | { account?: { name?: string; email?: string } | null }
    | undefined;

  const effectiveCustomerInfo = useMemo(() => {
    // Source 1: EPCheckoutProvider (composable flow)
    const ci = checkoutData?.customerInfo;
    if (ci?.firstName || ci?.email) {
      return { firstName: ci.firstName ?? "", lastName: ci.lastName ?? "", email: ci.email ?? "" };
    }
    // Source 2: EPCheckoutSessionProvider (session flow)
    const sci = checkoutSessionCtx?.session?.customerInfo;
    if (sci) {
      const parts = (sci.name ?? "").split(/\s+/);
      return {
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        email: sci.email ?? "",
      };
    }
    // Source 3: shopperContextData account profile (any ancestor DataProvider)
    const acct = shopperCtx?.account;
    if (acct?.name || acct?.email) {
      const parts = (acct.name ?? "").split(/\s+/);
      return {
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        email: acct.email ?? "",
      };
    }
    return undefined;
  }, [checkoutData?.customerInfo, checkoutSessionCtx?.session?.customerInfo, shopperCtx?.account]);

  // Design-time preview
  const useMock =
    previewState !== "auto" ||
    (inEditor && !effectiveCustomerInfo);

  if (useMock && previewState !== "auto") {
    const mockData = MOCK_MAP[previewState] ?? MOCK_MAP.empty;
    return (
      <DataProvider name="customerInfoFieldsData" data={mockData}>
        <div className={className} data-ep-customer-info-fields="">
          {children}
        </div>
      </DataProvider>
    );
  }

  // Render the runtime version (uses hooks)
  return (
    <EPCustomerInfoFieldsRuntime
      ref={ref}
      className={className}
      checkoutData={effectiveCustomerInfo ? { customerInfo: effectiveCustomerInfo } : undefined}
      inEditor={inEditor}
    >
      {children}
    </EPCustomerInfoFieldsRuntime>
  );
});

// ---------------------------------------------------------------------------
// Runtime (hooks-safe inner component)
// ---------------------------------------------------------------------------
interface RuntimeProps {
  children?: React.ReactNode;
  className?: string;
  checkoutData?: { customerInfo?: { firstName?: string; lastName?: string; email?: string } };
  inEditor: boolean;
}

const EPCustomerInfoFieldsRuntime = React.forwardRef<
  EPCustomerInfoFieldsActions,
  RuntimeProps
>(function EPCustomerInfoFieldsRuntime(props, ref) {
  const { children, className, checkoutData, inEditor } = props;

  // Pre-populate from checkout context
  const initial = checkoutData?.customerInfo;

  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");

  const [errors, setErrors] = useState<CustomerInfoErrors>({
    firstName: null,
    lastName: null,
    email: null,
  });

  const [touched, setTouched] = useState<CustomerInfoTouched>({
    firstName: false,
    lastName: false,
    email: false,
  });

  const [isDirty, setIsDirty] = useState(false);

  const isValid = useMemo(() => {
    const errs = validateAll({ firstName, lastName, email });
    return !errs.firstName && !errs.lastName && !errs.email;
  }, [firstName, lastName, email]);

  const setField = useCallback((name: FieldName, value: string) => {
    setIsDirty(true);
    setTouched((prev) => ({ ...prev, [name]: true }));
    // Clear error for this field
    setErrors((prev) => ({ ...prev, [name]: null }));

    switch (name) {
      case "firstName":
        setFirstName(value);
        break;
      case "lastName":
        setLastName(value);
        break;
      case "email":
        setEmail(value);
        break;
    }
  }, []);

  const validate = useCallback((): boolean => {
    const errs = validateAll({ firstName, lastName, email });
    setErrors(errs);
    setTouched({ firstName: true, lastName: true, email: true });
    const valid = !errs.firstName && !errs.lastName && !errs.email;
    log.debug("Validation result", { valid, errors: errs } as Record<string, unknown>);
    return valid;
  }, [firstName, lastName, email]);

  const clear = useCallback(() => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setErrors({ firstName: null, lastName: null, email: null });
    setTouched({ firstName: false, lastName: false, email: false });
    setIsDirty(false);
  }, []);

  useImperativeHandle(ref, () => ({ setField, validate, clear }), [
    setField,
    validate,
    clear,
  ]);

  const data = useMemo<CustomerInfoFieldsData>(
    () => ({
      firstName,
      lastName,
      email,
      errors,
      touched,
      isValid,
      isDirty,
    }),
    [firstName, lastName, email, errors, touched, isValid, isDirty]
  );

  // In editor with no context and auto mode — show empty mock
  if (inEditor && !initial) {
    return (
      <DataProvider name="customerInfoFieldsData" data={MOCK_CUSTOMER_INFO_EMPTY}>
        <div className={className} data-ep-customer-info-fields="">
          {children}
        </div>
      </DataProvider>
    );
  }

  return (
    <DataProvider name="customerInfoFieldsData" data={data}>
      <div className={className} data-ep-customer-info-fields="">
        {children}
      </div>
    </DataProvider>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epCustomerInfoFieldsMeta: CodeComponentMeta<EPCustomerInfoFieldsProps> =
  {
    name: "plasmic-commerce-ep-customer-info-fields",
    displayName: "EP Customer Info Fields",
    description:
      "Headless provider for customer identity fields (first name, last name, email) with validation. Bind inputs to customerInfoFieldsData.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              { type: "text", value: "First Name" },
              { type: "text", value: "Last Name" },
              { type: "text", value: "Email" },
            ],
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "empty", "filled", "withErrors"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCustomerInfoFields",
    providesData: true,
    refActions: {
      setField: {
        displayName: "Set Field",
        argTypes: [
          { name: "name", type: "string", displayName: "Field name" },
          { name: "value", type: "string", displayName: "Value" },
        ],
      },
      validate: {
        displayName: "Validate",
        argTypes: [],
      },
      clear: {
        displayName: "Clear",
        argTypes: [],
      },
    },
  };

export function registerEPCustomerInfoFields(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCustomerInfoFieldsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCustomerInfoFields,
    customMeta ?? epCustomerInfoFieldsMeta
  );
}
