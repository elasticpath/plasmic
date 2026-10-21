/**
 * EPAccountProfileField — name or email input for the profile form.
 * Reads and writes the surrounding EP Account Profile Form Provider.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { useAccountProfileForm } from "./EPAccountProfileFormProvider";

type ProfileFieldName = "name" | "email";

interface EPAccountProfileFieldProps {
  className?: string;
  name?: ProfileFieldName;
  label?: string;
}

const DEFAULT_LABEL: Record<ProfileFieldName, string> = {
  name: "Name",
  email: "Email",
};

function isProfileFieldName(name: string): name is ProfileFieldName {
  return name === "name" || name === "email";
}

export function EPAccountProfileField(props: EPAccountProfileFieldProps) {
  const { className, name = "name", label: labelProp } = props;
  const label = labelProp ?? (isProfileFieldName(name) ? DEFAULT_LABEL[name] : "");
  const inEditor = !!usePlasmicCanvasContext();
  const form = useAccountProfileForm();
  const id = `ep-account-profile-${name}`;

  if (!isProfileFieldName(name)) return null;

  const value = form.values[name] ?? "";
  const error = form.errors[name] ?? null;
  const locked = inEditor || form.status === "submitting";

  return (
    <div
      className={className}
      data-ep-form-field=""
      data-ep-field-state={error ? "invalid" : undefined}
    >
      <input
        id={id}
        data-ep-field-input=""
        type={name === "email" ? "email" : "text"}
        placeholder=" "
        value={value}
        autoComplete={name === "email" ? "email" : "name"}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          if (locked) return;
          form.setField(name, e.target.value);
        }}
        readOnly={locked}
      />
      <label data-ep-field-label="" htmlFor={id}>
        {label}
      </label>
      {error ? <span data-ep-field-error="">{error}</span> : null}
    </div>
  );
}

export const epAccountProfileFieldMeta: CodeComponentMeta<EPAccountProfileFieldProps> =
  {
    name: "plasmic-commerce-ep-account-profile-field",
    displayName: "EP Account Profile Field",
    description:
      "Name or email input for the EP Account Profile Form Provider. Shows the signed-in member's current value and renders its validation error. Read-only in the Studio canvas and while the profile form is submitting. Does not publish the value.",
    props: {
      name: {
        type: "choice",
        options: ["name", "email"],
        defaultValue: "name",
        displayName: "Name",
      },
      label: { type: "string" },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountProfileField",
    parentComponentName: "plasmic-commerce-ep-account-profile-form-provider",
  };

export function registerEPAccountProfileField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountProfileFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountProfileField,
    customMeta ?? epAccountProfileFieldMeta
  );
}
