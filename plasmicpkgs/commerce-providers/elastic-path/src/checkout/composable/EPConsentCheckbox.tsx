/**
 * EPConsentCheckbox — self-contained consent / opt-in checkbox.
 *
 * Reads/writes a boolean on the shared checkout form via useCheckoutForm().
 * Supports an inline link in the label (e.g. a Privacy Notice) and an
 * optional `revealOnCheck` slot (the "I have a purchase order number" →
 * reveals a PO-number field pattern).
 *
 * Generic DOM hooks: [data-ep-consent], [data-ep-consent-input],
 * [data-ep-consent-text], [data-ep-consent-link], [data-ep-consent-reveal].
 */
import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect } from "react";
import { Registerable } from "../../registerable";
import { useCheckoutForm } from "./EPCheckoutFormProvider";

interface EPConsentCheckboxProps {
  className?: string;
  name?: string;
  label?: string;
  required?: boolean;
  defaultChecked?: boolean;
  linkText?: string;
  linkHref?: string;
  revealOnCheck?: boolean;
  children?: React.ReactNode;
  fieldId?: string;
}

export function EPConsentCheckbox(props: EPConsentCheckboxProps) {
  const {
    className,
    name = "consent",
    label = "I agree",
    required = false,
    defaultChecked = false,
    linkText,
    linkHref,
    revealOnCheck = false,
    children,
    fieldId,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const form = useCheckoutForm();
  const id = fieldId || `ep-consent-${name}`;

  useEffect(() => {
    form.registerField(name, {
      required,
      kind: "checkbox",
      initialChecked: defaultChecked,
    });
    return () => form.unregisterField(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, required, defaultChecked]);

  const checked = form.booleans[name] ?? defaultChecked;
  const error = form.errors[name] ?? null;

  return (
    <div
      className={className}
      data-ep-consent=""
      data-ep-field-state={error ? "invalid" : undefined}
    >
      <label data-ep-consent-label="" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          data-ep-consent-input=""
          checked={checked}
          required={required}
          aria-invalid={error ? true : undefined}
          onChange={(e) => form.setBoolean(name, e.target.checked)}
        />
        <span data-ep-consent-text="">
          {label}
          {linkText ? (
            <>
              {" "}
              <a
                data-ep-consent-link=""
                href={linkHref || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={inEditor ? (e) => e.preventDefault() : undefined}
              >
                {linkText}
              </a>
            </>
          ) : null}
          {required ? " *" : ""}
        </span>
      </label>
      {revealOnCheck && checked ? (
        <div data-ep-consent-reveal="">{children}</div>
      ) : null}
      {error ? <span data-ep-field-error="">{error}</span> : null}
    </div>
  );
}

export const epConsentCheckboxMeta: CodeComponentMeta<EPConsentCheckboxProps> = {
  name: "plasmic-commerce-ep-consent-checkbox",
  displayName: "EP Consent Checkbox",
  description:
    "Self-contained consent checkbox. Registers a boolean into the surrounding EP Checkout Form Provider by `name` (saved as a cart custom attribute). Supports an inline link and a reveal-on-check slot.",
  props: {
    name: { type: "string", defaultValue: "consent" },
    label: { type: "string", defaultValue: "I agree" },
    required: { type: "boolean", defaultValue: false },
    defaultChecked: {
      type: "boolean",
      defaultValue: false,
      displayName: "Default Checked",
    },
    linkText: { type: "string", displayName: "Link Text", advanced: true },
    linkHref: { type: "string", displayName: "Link URL", advanced: true },
    revealOnCheck: {
      type: "boolean",
      defaultValue: false,
      displayName: "Reveal Slot When Checked",
      description: "Show the child slot only while this box is checked (e.g. a PO-number field).",
    },
    children: {
      type: "slot",
      displayName: "Revealed Content",
      hidePlaceholder: true,
    },
    fieldId: { type: "string", advanced: true, displayName: "Field ID" },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPConsentCheckbox",
};

export function registerEPConsentCheckbox(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPConsentCheckboxProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPConsentCheckbox, customMeta ?? epConsentCheckboxMeta);
}
