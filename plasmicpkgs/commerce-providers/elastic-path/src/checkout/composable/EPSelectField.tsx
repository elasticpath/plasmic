/**
 * EPSelectField — self-contained native <select> for the single-page checkout.
 *
 * Like EPFormField but renders a `<select>`. Options come from the
 * `options` string prop (one entry per line or comma-separated; each entry
 * is `value|Label` or just `Label`) or from the built-in `countries`
 * preset. Reads/writes the shared checkout form via useCheckoutForm().
 *
 * Floating label: selects have no `:placeholder-shown`, so the wrapper
 * carries `data-filled` when a value is chosen; the page Embed CSS floats
 * the label on `[data-ep-select-field][data-filled]` or `:focus-within`.
 */
import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useMemo } from "react";
import { Registerable } from "../../registerable";
import { useCheckoutForm } from "./EPCheckoutFormProvider";
import { COUNTRIES } from "./countries";

interface SelectOption {
  value: string;
  label: string;
}

interface EPSelectFieldProps {
  className?: string;
  name?: string;
  label?: string;
  required?: boolean;
  options?: string;
  preset?: "none" | "countries";
  fieldId?: string;
}

/** Parses the `options` string into {value,label} pairs. */
export function parseOptions(raw: string | undefined): SelectOption[] {
  if (!raw) return [];
  return raw
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.indexOf("|");
      if (pipe >= 0) {
        return { value: line.slice(0, pipe).trim(), label: line.slice(pipe + 1).trim() };
      }
      return { value: line, label: line };
    });
}

export function EPSelectField(props: EPSelectFieldProps) {
  const {
    className,
    name = "select",
    label = "Label",
    required = false,
    options,
    preset = "none",
    fieldId,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const form = useCheckoutForm();
  const id = fieldId || `ep-field-${name}`;

  const opts = useMemo<SelectOption[]>(() => {
    if (preset === "countries") {
      return COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
    }
    return parseOptions(options);
  }, [preset, options]);

  useEffect(() => {
    form.registerField(name, { required, kind: "select" });
    return () => form.unregisterField(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, required]);

  const value = form.values[name] ?? "";
  const error = form.errors[name] ?? null;

  return (
    <div
      className={className}
      data-ep-form-field=""
      data-ep-select-field=""
      data-filled={value ? "" : undefined}
      data-ep-field-state={error ? "invalid" : undefined}
    >
      <select
        id={id}
        data-ep-field-input=""
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-label={label}
        disabled={inEditor}
        onChange={(e) => form.setField(name, e.target.value)}
      >
        <option value="" />
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label data-ep-field-label="" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      {error ? <span data-ep-field-error="">{error}</span> : null}
    </div>
  );
}

export const epSelectFieldMeta: CodeComponentMeta<EPSelectFieldProps> = {
  name: "plasmic-commerce-ep-select-field",
  displayName: "EP Select Field",
  description:
    "Self-contained checkout dropdown. Registers into the surrounding EP Checkout Form Provider by `name`. Options from the `options` string or the `countries` preset.",
  props: {
    name: {
      type: "string",
      defaultValue: "select",
      description:
        "Form key. Reserved names map to the order or shipping address (including shippingCountry with the countries preset); anything else is saved as a cart custom attribute.",
    },
    label: { type: "string", defaultValue: "Label" },
    required: { type: "boolean", defaultValue: false },
    preset: {
      type: "choice",
      options: ["none", "countries"],
      defaultValue: "none",
      description: "Use the built-in ISO country list instead of `options`.",
    },
    options: {
      type: "string",
      displayName: "Options",
      description:
        "One option per line (or comma-separated). Use `value|Label` to set a distinct value. Ignored when preset = countries.",
    },
    fieldId: { type: "string", advanced: true, displayName: "Field ID" },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPSelectField",
};

export function registerEPSelectField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSelectFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSelectField, customMeta ?? epSelectFieldMeta);
}
