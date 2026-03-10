/**
 * EPShippingAddressFields — headless provider for shipping address fields.
 *
 * Manages address fields with validation, postcode pattern checking by country,
 * and optional address suggestion support. Exposes `shippingAddressFieldsData`
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
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { Registerable } from "../../registerable";
import {
  MOCK_SHIPPING_ADDRESS_EMPTY,
  MOCK_SHIPPING_ADDRESS_FILLED,
  MOCK_SHIPPING_ADDRESS_WITH_ERRORS,
  MOCK_SHIPPING_ADDRESS_WITH_SUGGESTIONS,
} from "../../utils/design-time-data";
import { createLogger } from "../../utils/logger";

const log = createLogger("EPShippingAddressFields");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "empty" | "filled" | "withErrors" | "withSuggestions";

type AddressFieldName =
  | "firstName"
  | "lastName"
  | "line1"
  | "line2"
  | "city"
  | "county"
  | "postcode"
  | "country"
  | "phone";

interface AddressErrors {
  firstName: string | null;
  lastName: string | null;
  line1: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  phone: string | null;
}

interface AddressTouched {
  firstName: boolean;
  lastName: boolean;
  line1: boolean;
  city: boolean;
  postcode: boolean;
  country: boolean;
  phone: boolean;
}

interface AddressSuggestion {
  line1: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
}

interface ShippingAddressFieldsData {
  firstName: string;
  lastName: string;
  line1: string;
  line2: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
  phone: string;
  errors: AddressErrors;
  touched: AddressTouched;
  isValid: boolean;
  isDirty: boolean;
  suggestions: AddressSuggestion[] | null;
  hasSuggestions: boolean;
}

interface EPShippingAddressFieldsActions {
  setField(name: AddressFieldName, value: string): void;
  validate(): boolean;
  clear(): void;
}

interface EPShippingAddressFieldsProps {
  children?: React.ReactNode;
  className?: string;
  showPhoneField?: boolean;
  previewState?: PreviewState;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const POSTCODE_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/,
};

function validatePostcode(value: string, country: string): string | null {
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

function validateAddressField(
  name: AddressFieldName,
  value: string,
  country: string,
  showPhone: boolean
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
    case "postcode":
      return validatePostcode(value, country);
    case "country":
      return value.trim() ? null : "Country is required";
    case "phone":
      if (!showPhone) return null;
      return value.trim() ? null : "Phone number is required";
    default:
      return null;
  }
}

function validateAllAddress(
  values: Record<string, string>,
  country: string,
  showPhone: boolean
): AddressErrors {
  return {
    firstName: validateAddressField("firstName", values.firstName || "", country, showPhone),
    lastName: validateAddressField("lastName", values.lastName || "", country, showPhone),
    line1: validateAddressField("line1", values.line1 || "", country, showPhone),
    city: validateAddressField("city", values.city || "", country, showPhone),
    postcode: validateAddressField("postcode", values.postcode || "", country, showPhone),
    country: validateAddressField("country", values.country || "", country, showPhone),
    phone: validateAddressField("phone", values.phone || "", country, showPhone),
  };
}

// ---------------------------------------------------------------------------
// Mock map
// ---------------------------------------------------------------------------
const MOCK_MAP: Record<string, ShippingAddressFieldsData> = {
  empty: MOCK_SHIPPING_ADDRESS_EMPTY as ShippingAddressFieldsData,
  filled: MOCK_SHIPPING_ADDRESS_FILLED as ShippingAddressFieldsData,
  withErrors: MOCK_SHIPPING_ADDRESS_WITH_ERRORS as ShippingAddressFieldsData,
  withSuggestions: MOCK_SHIPPING_ADDRESS_WITH_SUGGESTIONS as ShippingAddressFieldsData,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const EPShippingAddressFields = React.forwardRef<
  EPShippingAddressFieldsActions,
  EPShippingAddressFieldsProps
>(function EPShippingAddressFields(props, ref) {
  const { children, className, showPhoneField = true, previewState = "auto" } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // Read checkout session for pre-population
  const checkoutSessionCtx = useSelector("checkoutSession") as
    | { session?: { shippingAddress?: Record<string, string> | null } }
    | undefined;

  const effectiveAddress = checkoutSessionCtx?.session?.shippingAddress ?? undefined;

  const useMock =
    previewState !== "auto" ||
    (inEditor && !effectiveAddress);

  if (useMock && previewState !== "auto") {
    const mockData = MOCK_MAP[previewState] ?? MOCK_MAP.empty;
    return (
      <DataProvider name="shippingAddressFieldsData" data={mockData}>
        <div className={className} data-ep-shipping-address-fields="">
          {children}
        </div>
      </DataProvider>
    );
  }

  return (
    <EPShippingAddressFieldsRuntime
      ref={ref}
      className={className}
      showPhoneField={showPhoneField}
      checkoutData={effectiveAddress ? { shippingAddress: effectiveAddress } : undefined}
      inEditor={inEditor}
    >
      {children}
    </EPShippingAddressFieldsRuntime>
  );
});

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
interface RuntimeProps {
  children?: React.ReactNode;
  className?: string;
  showPhoneField: boolean;
  checkoutData?: { shippingAddress?: Record<string, string> };
  inEditor: boolean;
}

const EPShippingAddressFieldsRuntime = React.forwardRef<
  EPShippingAddressFieldsActions,
  RuntimeProps
>(function EPShippingAddressFieldsRuntime(props, ref) {
  const { children, className, showPhoneField, checkoutData, inEditor } = props;

  const initial = checkoutData?.shippingAddress;

  const [firstName, setFirstName] = useState(initial?.first_name ?? initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? initial?.lastName ?? "");
  const [line1, setLine1] = useState(initial?.line_1 ?? initial?.line1 ?? "");
  const [line2, setLine2] = useState(initial?.line_2 ?? initial?.line2 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [county, setCounty] = useState(initial?.county ?? "");
  const [postcode, setPostcode] = useState(initial?.postcode ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");

  const [errors, setErrors] = useState<AddressErrors>({
    firstName: null, lastName: null, line1: null,
    city: null, postcode: null, country: null, phone: null,
  });
  const [touched, setTouched] = useState<AddressTouched>({
    firstName: false, lastName: false, line1: false,
    city: false, postcode: false, country: false, phone: false,
  });
  const [isDirty, setIsDirty] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[] | null>(null);

  const values = useMemo(
    () => ({ firstName, lastName, line1, line2, city, county, postcode, country, phone }),
    [firstName, lastName, line1, line2, city, county, postcode, country, phone]
  );

  const isValid = useMemo(() => {
    const errs = validateAllAddress(values, country, showPhoneField);
    return Object.values(errs).every((e) => e === null);
  }, [values, country, showPhoneField]);

  const SETTERS: Record<AddressFieldName, React.Dispatch<React.SetStateAction<string>>> = useMemo(
    () => ({
      firstName: setFirstName,
      lastName: setLastName,
      line1: setLine1,
      line2: setLine2,
      city: setCity,
      county: setCounty,
      postcode: setPostcode,
      country: setCountry,
      phone: setPhone,
    }),
    []
  );

  const setField = useCallback((name: AddressFieldName, value: string) => {
    setIsDirty(true);
    const setter = SETTERS[name];
    if (setter) setter(value);
    if (name in errors) {
      setTouched((prev) => ({ ...prev, [name]: true }));
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  }, [SETTERS, errors]);

  const validate = useCallback((): boolean => {
    const errs = validateAllAddress(values, country, showPhoneField);
    setErrors(errs);
    setTouched({
      firstName: true, lastName: true, line1: true,
      city: true, postcode: true, country: true, phone: true,
    });
    const valid = Object.values(errs).every((e) => e === null);
    log.debug("Validation result", { valid, errors: errs } as Record<string, unknown>);
    return valid;
  }, [values, country, showPhoneField]);

  const clear = useCallback(() => {
    Object.values(SETTERS).forEach((s) => s(""));
    setErrors({
      firstName: null, lastName: null, line1: null,
      city: null, postcode: null, country: null, phone: null,
    });
    setTouched({
      firstName: false, lastName: false, line1: false,
      city: false, postcode: false, country: false, phone: false,
    });
    setIsDirty(false);
    setSuggestions(null);
  }, [SETTERS]);

  useImperativeHandle(ref, () => ({ setField, validate, clear }), [
    setField, validate, clear,
  ]);

  const data = useMemo<ShippingAddressFieldsData>(
    () => ({
      ...values,
      errors,
      touched,
      isValid,
      isDirty,
      suggestions,
      hasSuggestions: !!suggestions && suggestions.length > 0,
    }),
    [values, errors, touched, isValid, isDirty, suggestions]
  );

  // In editor with no context — show empty mock
  if (inEditor && !initial) {
    return (
      <DataProvider name="shippingAddressFieldsData" data={MOCK_SHIPPING_ADDRESS_EMPTY}>
        <div className={className} data-ep-shipping-address-fields="">
          {children}
        </div>
      </DataProvider>
    );
  }

  return (
    <DataProvider name="shippingAddressFieldsData" data={data}>
      <div className={className} data-ep-shipping-address-fields="">
        {children}
      </div>
    </DataProvider>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epShippingAddressFieldsMeta: ComponentMeta<EPShippingAddressFieldsProps> =
  {
    name: "plasmic-commerce-ep-shipping-address-fields",
    displayName: "EP Shipping Address Fields",
    description:
      "Headless provider for shipping address fields with validation and postcode pattern checking. Bind inputs to shippingAddressFieldsData.",
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
              { type: "text", value: "Phone" },
            ],
          },
        ],
      },
      showPhoneField: {
        type: "boolean",
        defaultValue: true,
        displayName: "Show Phone Field",
        description: "Whether to validate the phone field",
      },
      previewState: {
        type: "choice",
        options: ["auto", "empty", "filled", "withErrors", "withSuggestions"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPShippingAddressFields",
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

export function registerEPShippingAddressFields(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPShippingAddressFieldsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPShippingAddressFields,
    customMeta ?? epShippingAddressFieldsMeta
  );
}
