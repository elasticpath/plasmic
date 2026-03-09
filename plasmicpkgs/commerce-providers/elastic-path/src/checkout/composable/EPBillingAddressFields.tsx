/**
 * EPBillingAddressFields — headless provider for billing address fields.
 *
 * When "same as shipping" is active (via EPBillingAddressToggle or
 * checkoutData.sameAsShipping), mirrors the shipping address data.
 * Otherwise maintains independent field state with validation.
 *
 * Exposes `billingAddressFieldsData` via DataProvider.
 *
 * refActions: setField, validate, clear
 */
import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { Registerable } from "../../registerable";
import {
  MOCK_SHIPPING_ADDRESS_FILLED,
  MOCK_BILLING_ADDRESS_DIFFERENT,
} from "../../utils/design-time-data";
import { createLogger } from "../../utils/logger";

const log = createLogger("EPBillingAddressFields");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "sameAsShipping" | "different" | "withErrors";

type BillingFieldName =
  | "firstName"
  | "lastName"
  | "line1"
  | "line2"
  | "city"
  | "county"
  | "postcode"
  | "country";

interface BillingErrors {
  firstName: string | null;
  lastName: string | null;
  line1: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
}

interface BillingTouched {
  firstName: boolean;
  lastName: boolean;
  line1: boolean;
  city: boolean;
  postcode: boolean;
  country: boolean;
}

interface BillingAddressFieldsData {
  firstName: string;
  lastName: string;
  line1: string;
  line2: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
  errors: BillingErrors;
  touched: BillingTouched;
  isValid: boolean;
  isDirty: boolean;
  isMirroringShipping: boolean;
}

interface EPBillingAddressFieldsActions {
  setField(name: BillingFieldName, value: string): void;
  validate(): boolean;
  clear(): void;
}

interface EPBillingAddressFieldsProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

// ---------------------------------------------------------------------------
// Validation (same logic as shipping, minus phone)
// ---------------------------------------------------------------------------
const POSTCODE_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/,
};

function validateBillingField(
  name: BillingFieldName,
  value: string,
  country: string
): string | null {
  switch (name) {
    case "firstName":
      return value.trim() ? null : "First name is required";
    case "lastName":
      return value.trim() ? null : "Last name is required";
    case "line1":
      return value.trim() ? null : "Street address is required";
    case "city":
      return value.trim() ? null : "City is required";
    case "postcode": {
      if (!value.trim()) return "Postal code is required";
      const pattern = POSTCODE_PATTERNS[country];
      if (pattern && !pattern.test(value.trim())) {
        return country === "US"
          ? "Enter a valid ZIP code"
          : country === "CA"
            ? "Enter a valid postal code (e.g. A1A 1A1)"
            : "Enter a valid postal code";
      }
      return null;
    }
    case "country":
      return value.trim() ? null : "Country is required";
    default:
      return null;
  }
}

function validateAllBilling(
  values: Record<string, string>,
  country: string
): BillingErrors {
  return {
    firstName: validateBillingField("firstName", values.firstName || "", country),
    lastName: validateBillingField("lastName", values.lastName || "", country),
    line1: validateBillingField("line1", values.line1 || "", country),
    city: validateBillingField("city", values.city || "", country),
    postcode: validateBillingField("postcode", values.postcode || "", country),
    country: validateBillingField("country", values.country || "", country),
  };
}

const EMPTY_ERRORS: BillingErrors = {
  firstName: null, lastName: null, line1: null,
  city: null, postcode: null, country: null,
};
const EMPTY_TOUCHED: BillingTouched = {
  firstName: false, lastName: false, line1: false,
  city: false, postcode: false, country: false,
};
const ALL_TOUCHED: BillingTouched = {
  firstName: true, lastName: true, line1: true,
  city: true, postcode: true, country: true,
};

// ---------------------------------------------------------------------------
// Mock data for design-time
// ---------------------------------------------------------------------------
const MOCK_SAME_AS_SHIPPING: BillingAddressFieldsData = {
  firstName: (MOCK_SHIPPING_ADDRESS_FILLED as any).firstName,
  lastName: (MOCK_SHIPPING_ADDRESS_FILLED as any).lastName,
  line1: (MOCK_SHIPPING_ADDRESS_FILLED as any).line1,
  line2: (MOCK_SHIPPING_ADDRESS_FILLED as any).line2 ?? "",
  city: (MOCK_SHIPPING_ADDRESS_FILLED as any).city,
  county: (MOCK_SHIPPING_ADDRESS_FILLED as any).county,
  postcode: (MOCK_SHIPPING_ADDRESS_FILLED as any).postcode,
  country: (MOCK_SHIPPING_ADDRESS_FILLED as any).country,
  errors: EMPTY_ERRORS,
  touched: ALL_TOUCHED,
  isValid: true,
  isDirty: false,
  isMirroringShipping: true,
};

const MOCK_WITH_ERRORS: BillingAddressFieldsData = {
  firstName: "Jane",
  lastName: "Smith",
  line1: "",
  line2: "",
  city: "Seattle",
  county: "WA",
  postcode: "INVALID",
  country: "US",
  errors: {
    firstName: null,
    lastName: null,
    line1: "Street address is required",
    city: null,
    postcode: "Enter a valid ZIP code",
    country: null,
  },
  touched: ALL_TOUCHED,
  isValid: false,
  isDirty: true,
  isMirroringShipping: false,
};

const MOCK_MAP: Record<string, BillingAddressFieldsData> = {
  sameAsShipping: MOCK_SAME_AS_SHIPPING,
  different: MOCK_BILLING_ADDRESS_DIFFERENT as BillingAddressFieldsData,
  withErrors: MOCK_WITH_ERRORS,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const EPBillingAddressFields = React.forwardRef<
  EPBillingAddressFieldsActions,
  EPBillingAddressFieldsProps
>(function EPBillingAddressFields(props, ref) {
  const { children, className, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // Sources for "same as shipping" toggle
  const billingToggleData = useSelector("billingToggleData") as
    | { isSameAsShipping?: boolean }
    | undefined;
  const checkoutData = useSelector("checkoutData") as
    | { sameAsShipping?: boolean; billingAddress?: Record<string, string> }
    | undefined;

  // Shipping address data for mirroring
  const shippingData = useSelector("shippingAddressFieldsData") as
    | Record<string, any>
    | undefined;

  // Design-time preview
  if (previewState !== "auto") {
    const mockData = MOCK_MAP[previewState] ?? MOCK_SAME_AS_SHIPPING;
    return (
      <DataProvider name="billingAddressFieldsData" data={mockData}>
        <div className={className} data-ep-billing-address-fields="">
          {children}
        </div>
      </DataProvider>
    );
  }

  // Determine mirroring state
  const isMirroring =
    billingToggleData?.isSameAsShipping ??
    checkoutData?.sameAsShipping ??
    true; // default to same-as-shipping

  // When mirroring, expose shipping data directly
  if (isMirroring) {
    const mirroredData: BillingAddressFieldsData = shippingData
      ? {
          firstName: shippingData.firstName ?? "",
          lastName: shippingData.lastName ?? "",
          line1: shippingData.line1 ?? "",
          line2: shippingData.line2 ?? "",
          city: shippingData.city ?? "",
          county: shippingData.county ?? "",
          postcode: shippingData.postcode ?? "",
          country: shippingData.country ?? "",
          errors: EMPTY_ERRORS,
          touched: ALL_TOUCHED,
          isValid: shippingData.isValid ?? true,
          isDirty: false,
          isMirroringShipping: true,
        }
      : inEditor
        ? MOCK_SAME_AS_SHIPPING
        : {
            firstName: "", lastName: "", line1: "", line2: "",
            city: "", county: "", postcode: "", country: "",
            errors: EMPTY_ERRORS, touched: EMPTY_TOUCHED,
            isValid: false, isDirty: false, isMirroringShipping: true,
          };

    // Expose no-op ref actions when mirroring
    if (ref && typeof ref !== "function") {
      // eslint-disable-next-line react-hooks/rules-of-hooks
    }

    return (
      <BillingMirrorWrapper ref={ref} className={className} data={mirroredData}>
        {children}
      </BillingMirrorWrapper>
    );
  }

  // Independent billing address
  return (
    <EPBillingAddressFieldsRuntime
      ref={ref}
      className={className}
      checkoutData={checkoutData}
      inEditor={inEditor}
    >
      {children}
    </EPBillingAddressFieldsRuntime>
  );
});

// ---------------------------------------------------------------------------
// Mirror wrapper (no-op refActions)
// ---------------------------------------------------------------------------
interface MirrorWrapperProps {
  children?: React.ReactNode;
  className?: string;
  data: BillingAddressFieldsData;
}

const BillingMirrorWrapper = React.forwardRef<
  EPBillingAddressFieldsActions,
  MirrorWrapperProps
>(function BillingMirrorWrapper(props, ref) {
  const { children, className, data } = props;

  useImperativeHandle(ref, () => ({
    setField: () => {
      log.debug("setField is a no-op when mirroring shipping address");
    },
    validate: () => {
      log.debug("validate is a no-op when mirroring shipping address");
      return true;
    },
    clear: () => {
      log.debug("clear is a no-op when mirroring shipping address");
    },
  }), []);

  return (
    <DataProvider name="billingAddressFieldsData" data={data}>
      <div className={className} data-ep-billing-address-fields="">
        {children}
      </div>
    </DataProvider>
  );
});

// ---------------------------------------------------------------------------
// Runtime (independent billing address with hooks)
// ---------------------------------------------------------------------------
interface RuntimeProps {
  children?: React.ReactNode;
  className?: string;
  checkoutData?: { billingAddress?: Record<string, string> };
  inEditor: boolean;
}

const EPBillingAddressFieldsRuntime = React.forwardRef<
  EPBillingAddressFieldsActions,
  RuntimeProps
>(function EPBillingAddressFieldsRuntime(props, ref) {
  const { children, className, checkoutData, inEditor } = props;

  const initial = checkoutData?.billingAddress;

  const [firstName, setFirstName] = useState(initial?.first_name ?? initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? initial?.lastName ?? "");
  const [line1, setLine1] = useState(initial?.line_1 ?? initial?.line1 ?? "");
  const [line2, setLine2] = useState(initial?.line_2 ?? initial?.line2 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [county, setCounty] = useState(initial?.county ?? "");
  const [postcode, setPostcode] = useState(initial?.postcode ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");

  const [errors, setErrors] = useState<BillingErrors>({ ...EMPTY_ERRORS });
  const [touched, setTouched] = useState<BillingTouched>({ ...EMPTY_TOUCHED });
  const [isDirty, setIsDirty] = useState(false);

  const values = useMemo(
    () => ({ firstName, lastName, line1, line2, city, county, postcode, country }),
    [firstName, lastName, line1, line2, city, county, postcode, country]
  );

  const isValid = useMemo(() => {
    const errs = validateAllBilling(values, country);
    return Object.values(errs).every((e) => e === null);
  }, [values, country]);

  const SETTERS: Record<BillingFieldName, React.Dispatch<React.SetStateAction<string>>> = useMemo(
    () => ({
      firstName: setFirstName,
      lastName: setLastName,
      line1: setLine1,
      line2: setLine2,
      city: setCity,
      county: setCounty,
      postcode: setPostcode,
      country: setCountry,
    }),
    []
  );

  const setField = useCallback((name: BillingFieldName, value: string) => {
    setIsDirty(true);
    const setter = SETTERS[name];
    if (setter) setter(value);
    if (name in EMPTY_ERRORS) {
      setTouched((prev) => ({ ...prev, [name]: true }));
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  }, [SETTERS]);

  const validate = useCallback((): boolean => {
    const errs = validateAllBilling(values, country);
    setErrors(errs);
    setTouched({ ...ALL_TOUCHED });
    const valid = Object.values(errs).every((e) => e === null);
    log.debug("Validation result", { valid, errors: errs } as Record<string, unknown>);
    return valid;
  }, [values, country]);

  const clear = useCallback(() => {
    Object.values(SETTERS).forEach((s) => s(""));
    setErrors({ ...EMPTY_ERRORS });
    setTouched({ ...EMPTY_TOUCHED });
    setIsDirty(false);
  }, [SETTERS]);

  useImperativeHandle(ref, () => ({ setField, validate, clear }), [
    setField, validate, clear,
  ]);

  const data = useMemo<BillingAddressFieldsData>(
    () => ({
      ...values,
      errors,
      touched,
      isValid,
      isDirty,
      isMirroringShipping: false,
    }),
    [values, errors, touched, isValid, isDirty]
  );

  return (
    <DataProvider name="billingAddressFieldsData" data={data}>
      <div className={className} data-ep-billing-address-fields="">
        {children}
      </div>
    </DataProvider>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epBillingAddressFieldsMeta: ComponentMeta<EPBillingAddressFieldsProps> =
  {
    name: "plasmic-commerce-ep-billing-address-fields",
    displayName: "EP Billing Address Fields",
    description:
      "Headless provider for billing address fields. Mirrors shipping address when 'same as shipping' is active, otherwise maintains independent fields with validation.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "vbox",
            children: [
              { type: "text", value: "First Name" },
              { type: "text", value: "Last Name" },
              { type: "text", value: "Address Line 1" },
              { type: "text", value: "City" },
              { type: "text", value: "State/Province" },
              { type: "text", value: "Postal Code" },
              { type: "text", value: "Country" },
            ],
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "sameAsShipping", "different", "withErrors"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPBillingAddressFields",
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

export function registerEPBillingAddressFields(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBillingAddressFieldsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBillingAddressFields,
    customMeta ?? epBillingAddressFieldsMeta
  );
}
