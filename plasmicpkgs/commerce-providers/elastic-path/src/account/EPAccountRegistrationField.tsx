/**
 * EPAccountRegistrationField — one input for the registration form.
 * Reads and writes the surrounding EP Account Registration Form Provider.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect } from "react";
import { Registerable } from "../registerable";
import { useAccountRegistrationForm } from "./EPAccountRegistrationFormProvider";

type RegistrationFieldName =
  | "name"
  | "email"
  | "username"
  | "password"
  | "confirmPassword";

interface EPAccountRegistrationFieldProps {
  className?: string;
  name?: RegistrationFieldName;
  label?: string;
}

const DEFAULT_LABEL: Record<RegistrationFieldName, string> = {
  name: "Name",
  email: "Email",
  username: "Username",
  password: "Password",
  confirmPassword: "Confirm password",
};

function isRegistrationFieldName(name: string): name is RegistrationFieldName {
  return (
    name === "name" ||
    name === "email" ||
    name === "username" ||
    name === "password" ||
    name === "confirmPassword"
  );
}

function inputType(name: RegistrationFieldName): "text" | "email" | "password" {
  if (name === "email") return "email";
  if (name === "password" || name === "confirmPassword") return "password";
  return "text";
}

function inputAutoComplete(name: RegistrationFieldName): string {
  if (name === "name") return "name";
  if (name === "email") return "email";
  if (name === "username") return "username";
  return "new-password";
}

export function EPAccountRegistrationField(
  props: EPAccountRegistrationFieldProps
) {
  const { className, name = "name", label: labelProp } = props;
  const label = labelProp ?? (isRegistrationFieldName(name) ? DEFAULT_LABEL[name] : "");
  const inEditor = !!usePlasmicCanvasContext();
  const form = useAccountRegistrationForm();
  const id = `ep-account-registration-${name}`;

  useEffect(() => {
    if (!isRegistrationFieldName(name)) return;
    form.registerField(name);
    return () => form.unregisterField(name);
    // register/unregister are stable; re-run only when the field identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (!isRegistrationFieldName(name)) return null;

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
        type={inputType(name)}
        placeholder=" "
        value={value}
        required
        autoComplete={inputAutoComplete(name)}
        aria-invalid={error ? true : undefined}
        onChange={(e) => form.setField(name, e.target.value)}
        readOnly={inEditor}
      />
      <label data-ep-field-label="" htmlFor={id}>
        {label} *
      </label>
      {error ? <span data-ep-field-error="">{error}</span> : null}
    </div>
  );
}

export const epAccountRegistrationFieldMeta: CodeComponentMeta<EPAccountRegistrationFieldProps> =
  {
    name: "plasmic-commerce-ep-account-registration-field",
    displayName: "EP Account Registration Field",
    description:
      "Name, email, username, password, or confirm-password input for the EP Account Registration Form Provider. Registers with that form and renders its validation error. Does not publish the value.",
    props: {
      name: {
        type: "choice",
        options: ["name", "email", "username", "password", "confirmPassword"],
        defaultValue: "name",
        displayName: "Name",
      },
      label: { type: "string", defaultValue: "Name" },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountRegistrationField",
    parentComponentName: "plasmic-commerce-ep-account-registration-form-provider",
  };

export function registerEPAccountRegistrationField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountRegistrationFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountRegistrationField,
    customMeta ?? epAccountRegistrationFieldMeta
  );
}
