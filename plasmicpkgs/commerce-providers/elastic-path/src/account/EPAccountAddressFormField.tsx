/** EPAccountAddressFormField — one input for creating a saved address. */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useId } from "react";
import { COUNTRIES } from "../checkout/composable/countries";
import { Registerable } from "../registerable";
import { useAccountAddressForm } from "./EPAccountAddressFormProvider";
import type { AccountAddressFieldName } from "./types";

interface EPAccountAddressFormFieldProps {
  className?: string;
  name?: AccountAddressFieldName;
  label?: string;
  required?: boolean;
}

const DEFAULT_LABEL: Record<AccountAddressFieldName, string> = {
  name: "Name",
  first_name: "First name",
  last_name: "Last name",
  company_name: "Company name",
  phone_number: "Phone number",
  instructions: "Instructions",
  line_1: "Line 1",
  line_2: "Line 2",
  city: "City",
  county: "County",
  region: "Region",
  postcode: "Postcode",
  country: "Country",
};

const FIELD_OPTIONS: { label: string; value: AccountAddressFieldName }[] = [
  { label: "Name", value: "name" },
  { label: "First name", value: "first_name" },
  { label: "Last name", value: "last_name" },
  { label: "Company name", value: "company_name" },
  { label: "Phone number", value: "phone_number" },
  { label: "Instructions", value: "instructions" },
  { label: "Line 1", value: "line_1" },
  { label: "Line 2", value: "line_2" },
  { label: "City", value: "city" },
  { label: "County", value: "county" },
  { label: "Region", value: "region" },
  { label: "Postcode", value: "postcode" },
  { label: "Country", value: "country" },
];

function isAddressFieldName(name: string): name is AccountAddressFieldName {
  return Object.prototype.hasOwnProperty.call(DEFAULT_LABEL, name);
}

function inputAutoComplete(name: AccountAddressFieldName): string {
  switch (name) {
    case "name":
      return "off";
    case "first_name":
      return "given-name";
    case "last_name":
      return "family-name";
    case "company_name":
      return "organization";
    case "phone_number":
      return "tel";
    case "line_1":
      return "address-line1";
    case "line_2":
      return "address-line2";
    case "city":
      return "address-level2";
    case "county":
    case "region":
      return "address-level1";
    case "postcode":
      return "postal-code";
    case "country":
      return "country";
    default:
      return "off";
  }
}

export function EPAccountAddressFormField(
  props: EPAccountAddressFormFieldProps
) {
  const { className, name = "name", label: labelProp, required = false } = props;
  const instanceId = useId();
  const label =
    labelProp ?? (isAddressFieldName(name) ? DEFAULT_LABEL[name] : "");
  const inEditor = !!usePlasmicCanvasContext();
  const form = useAccountAddressForm();

  useEffect(() => {
    if (!isAddressFieldName(name)) return;
    form.registerField(instanceId, { name, required });
    return () => form.unregisterField(instanceId);
    // register/unregister are stable; re-run only when this instance changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, name, required]);

  if (!isAddressFieldName(name)) return null;

  const value = form.values[name] ?? "";
  const error = form.errors[name] ?? null;
  const locked = inEditor || form.status === "submitting";
  const id = `ep-account-address-form-${instanceId}`;

  const described = error ? { "aria-invalid": true as const } : {};

  return (
    <div
      className={className}
      data-ep-form-field=""
      data-ep-field-state={error ? "invalid" : undefined}
    >
      {name === "country" ? (
        <select
          id={id}
          data-ep-field-input=""
          value={value}
          autoComplete="country"
          required={required}
          disabled={locked}
          {...described}
          onChange={(e) => {
            if (locked) return;
            form.setField(name, e.target.value);
          }}
        >
          <option value="">Select country</option>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          data-ep-field-input=""
          type={name === "phone_number" ? "tel" : "text"}
          placeholder=" "
          value={value}
          autoComplete={inputAutoComplete(name)}
          required={required}
          {...described}
          onChange={(e) => {
            if (locked) return;
            form.setField(name, e.target.value);
          }}
          readOnly={locked}
        />
      )}
      <label data-ep-field-label="" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      {error ? <span data-ep-field-error="">{error}</span> : null}
    </div>
  );
}

export const epAccountAddressFormFieldMeta: CodeComponentMeta<EPAccountAddressFormFieldProps> =
  {
    name: "plasmic-commerce-ep-account-address-form-field",
    displayName: "EP Account Address Form Field",
    description:
      "One address input for the EP Account Address Form Provider. Required is a Studio setting for this field and is not inferred from the field name. Country is a dropdown of country names and submits the ISO alpha-2 code. Renders its validation error. Read-only in the Studio canvas and while the form is submitting. Does not publish the value.",
    props: {
      name: {
        type: "choice",
        options: FIELD_OPTIONS,
        defaultValue: "name",
        displayName: "Field",
      },
      label: { type: "string" },
      required: {
        type: "boolean",
        defaultValue: false,
        displayName: "Required",
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountAddressFormField",
    parentComponentName: "plasmic-commerce-ep-account-address-form-provider",
  };

export function registerEPAccountAddressFormField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountAddressFormFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountAddressFormField,
    customMeta ?? epAccountAddressFormFieldMeta
  );
}
