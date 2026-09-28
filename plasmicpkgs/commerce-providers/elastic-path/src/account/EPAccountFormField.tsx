/**
 * EPAccountFormField — username or password input for the login form.
 * Reads and writes the surrounding EP Account Login Form Provider.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect } from "react";
import { Registerable } from "../registerable";
import { useAccountLoginForm } from "./EPAccountLoginFormProvider";

type AccountFormFieldName = "username" | "password";
type AccountFormInputType = "text" | "email" | "password";

interface EPAccountFormFieldProps {
  className?: string;
  name?: AccountFormFieldName;
  label?: string;
  inputType?: AccountFormInputType;
  required?: boolean;
}

function isAccountFormFieldName(name: string): name is AccountFormFieldName {
  return name === "username" || name === "password";
}

function inputAutoComplete(
  name: AccountFormFieldName,
  inputType: AccountFormInputType
): string | undefined {
  if (inputType === "email") return "email";
  if (inputType === "password") return "current-password";
  if (name === "username") return "username";
  return undefined;
}

export function EPAccountFormField(props: EPAccountFormFieldProps) {
  const {
    className,
    name = "username",
    label = "Username",
    inputType = "text",
    required = true,
  } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const form = useAccountLoginForm();
  const id = `ep-account-login-${name}`;

  useEffect(() => {
    if (!isAccountFormFieldName(name)) return;
    form.registerField(name, { required });
    return () => form.unregisterField(name);
    // register/unregister are stable; re-run only when the field identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, required]);

  if (!isAccountFormFieldName(name)) return null;

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
        autoComplete={inputAutoComplete(name, inputType)}
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

export const epAccountFormFieldMeta: CodeComponentMeta<EPAccountFormFieldProps> =
  {
    name: "plasmic-commerce-ep-account-form-field",
    displayName: "EP Account Form Field",
    description:
      "Username or password input for the EP Account Login Form Provider. Registers with that form and renders its validation error. Does not publish the value.",
    props: {
      name: {
        type: "choice",
        options: ["username", "password"],
        defaultValue: "username",
        displayName: "Name",
      },
      label: { type: "string", defaultValue: "Username" },
      inputType: {
        type: "choice",
        options: ["text", "email", "password"],
        defaultValue: "text",
        displayName: "Input Type",
      },
      required: { type: "boolean", defaultValue: true },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountFormField",
    parentComponentName: "plasmic-commerce-ep-account-login-form-provider",
  };

export function registerEPAccountFormField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountFormFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPAccountFormField, customMeta ?? epAccountFormFieldMeta);
}
