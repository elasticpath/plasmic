/**
 * The form a composable-checkout field group renders when its slot is empty.
 *
 * These components are headless: they own field state, validation and the
 * `setField` ref action, and let the designer build the markup. But an empty
 * slot used to be filled with a default of three or eight *text labels* — a
 * thing that looks like a form, collects nothing, and leaves the checkout
 * unable to advance. A designer who drops in the required sections now gets
 * working inputs, and anything placed in the slot still replaces them.
 *
 * The markup reuses EPFormField's `[data-ep-field-*]` hooks so the same
 * checkout styles apply to both.
 */
import React from "react";
import { COUNTRIES } from "./countries";

export interface DefaultFieldSpec {
  /** Key into the group's values/errors maps, and the `setField` name. */
  name: string;
  label: string;
  inputType?: "text" | "email" | "tel";
  required?: boolean;
  autoComplete?: string;
  /** Render a country dropdown instead of a text input. */
  kind?: "country";
}

interface DefaultFieldsFormProps {
  fields: DefaultFieldSpec[];
  values: Record<string, unknown>;
  /**
   * Any of the groups' error maps. Each group declares its own closed shape
   * (`CustomerInfoErrors`, `AddressErrors`, `BillingErrors`), none of which is
   * assignable to an index signature, so this stays `unknown` and the lookup
   * below is the single place that narrows.
   */
  errors?: unknown;
  onChange: (name: string, value: string) => void;
  /** Disable editing on the Studio canvas. */
  readOnly?: boolean;
}

export function DefaultFieldsForm(props: DefaultFieldsFormProps) {
  const { fields, values, errors, onChange, readOnly } = props;

  return (
    <div data-ep-default-fields="">
      {fields.map((field) => {
        const id = `ep-field-${field.name}`;
        const rawError = (errors as Record<string, unknown> | undefined)?.[
          field.name
        ];
        const error = typeof rawError === "string" && rawError ? rawError : null;
        const raw = values?.[field.name];
        const value = typeof raw === "string" ? raw : "";

        return (
          <div
            key={field.name}
            data-ep-form-field=""
            data-ep-field-state={error ? "invalid" : undefined}
          >
            {field.kind === "country" ? (
              <select
                id={id}
                data-ep-field-input=""
                value={value}
                required={field.required}
                autoComplete={field.autoComplete}
                aria-invalid={error ? true : undefined}
                aria-label={field.label}
                disabled={readOnly}
                onChange={(e) => onChange(field.name, e.target.value)}
              >
                <option value="">Select a country</option>
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
                type={field.inputType ?? "text"}
                placeholder=" "
                value={value}
                required={field.required}
                autoComplete={field.autoComplete}
                aria-invalid={error ? true : undefined}
                onChange={(e) => onChange(field.name, e.target.value)}
                readOnly={readOnly}
              />
            )}
            <label data-ep-field-label="" htmlFor={id}>
              {field.label}
              {field.required ? " *" : ""}
            </label>
            {error ? <span data-ep-field-error="">{error}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export const CUSTOMER_INFO_DEFAULT_FIELDS: DefaultFieldSpec[] = [
  { name: "firstName", label: "First name", required: true, autoComplete: "given-name" },
  { name: "lastName", label: "Last name", required: true, autoComplete: "family-name" },
  { name: "email", label: "Email", inputType: "email", required: true, autoComplete: "email" },
];

export const ADDRESS_DEFAULT_FIELDS: DefaultFieldSpec[] = [
  { name: "firstName", label: "First name", required: true, autoComplete: "given-name" },
  { name: "lastName", label: "Last name", required: true, autoComplete: "family-name" },
  { name: "line1", label: "Address", required: true, autoComplete: "address-line1" },
  { name: "line2", label: "Address line 2", autoComplete: "address-line2" },
  { name: "city", label: "City", required: true, autoComplete: "address-level2" },
  { name: "county", label: "State / province", autoComplete: "address-level1" },
  { name: "postcode", label: "Postal code", required: true, autoComplete: "postal-code" },
  { name: "country", label: "Country", required: true, kind: "country", autoComplete: "country" },
  { name: "phone", label: "Phone", inputType: "tel", autoComplete: "tel" },
];

/** Billing has no phone field. */
export const BILLING_DEFAULT_FIELDS: DefaultFieldSpec[] = ADDRESS_DEFAULT_FIELDS.filter(
  (field) => field.name !== "phone"
);
