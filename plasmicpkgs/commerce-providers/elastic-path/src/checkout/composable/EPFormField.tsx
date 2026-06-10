/**
 * EPFormField — self-contained text input for the single-page checkout.
 *
 * Renders its own `<input>` (with a floating-label-ready structure) and
 * reads/writes the shared checkout form via useCheckoutForm(). No Plasmic
 * interaction wiring needed — drop it inside an EPCheckoutFormProvider and
 * give it a `name`.
 *
 * Stable, generic DOM hooks for styling (the ISO look lives in the page's
 * Embed CSS, not here):
 *   [data-ep-form-field]            wrapper
 *   [data-ep-field-input]           the <input>
 *   [data-ep-field-label]           the floating <label>
 *   [data-ep-field-error]           validation message
 * Floating label works with the controlled input because the placeholder is
 * a single space: `[data-ep-field-input]:not(:placeholder-shown) ~ [data-ep-field-label]`.
 */
import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect } from "react";
import { Registerable } from "../../registerable";
import { useCheckoutForm } from "./EPCheckoutFormProvider";

interface EPFormFieldProps {
  className?: string;
  name?: string;
  label?: string;
  inputType?: "text" | "email" | "tel" | "number";
  required?: boolean;
  autoComplete?: string;
  fieldId?: string;
}

export function EPFormField(props: EPFormFieldProps) {
  const {
    className,
    name = "field",
    label = "Label",
    inputType = "text",
    required = false,
    autoComplete,
    fieldId,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const form = useCheckoutForm();
  const id = fieldId || `ep-field-${name}`;

  useEffect(() => {
    form.registerField(name, { required, kind: "text" });
    return () => form.unregisterField(name);
    // form callbacks are stable; re-run only when identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, required]);

  const value = form.values[name] ?? "";
  const error = form.errors[name] ?? null;

  return (
    <div
      className={className}
      data-ep-form-field=""
      data-ep-field-state={error ? "invalid" : undefined}
    >
      <input
        id={id}
        data-ep-field-input=""
        type={inputType}
        placeholder=" "
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        onChange={(e) => form.setField(name, e.target.value)}
        readOnly={inEditor}
      />
      <label data-ep-field-label="" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      {error ? <span data-ep-field-error="">{error}</span> : null}
    </div>
  );
}

export const epFormFieldMeta: CodeComponentMeta<EPFormFieldProps> = {
  name: "plasmic-commerce-ep-form-field",
  displayName: "EP Form Field",
  description:
    "Self-contained checkout text input. Registers into the surrounding EP Checkout Form Provider by `name`. Floating-label ready via the [data-ep-field-*] hooks.",
  props: {
    name: {
      type: "string",
      defaultValue: "field",
      description:
        "Form key. Reserved names (firstName, lastName, email, company, address, line2, city, county, postal, country) map to the order; anything else is saved as a cart custom attribute.",
    },
    label: { type: "string", defaultValue: "Label" },
    inputType: {
      type: "choice",
      options: ["text", "email", "tel", "number"],
      defaultValue: "text",
      displayName: "Input Type",
    },
    required: { type: "boolean", defaultValue: false },
    autoComplete: { type: "string", advanced: true, displayName: "Autocomplete" },
    fieldId: { type: "string", advanced: true, displayName: "Field ID" },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPFormField",
};

export function registerEPFormField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPFormFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPFormField, customMeta ?? epFormFieldMeta);
}
