import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../../registerable";
import { COUNTRIES, DEFAULT_PRIORITY_COUNTRIES } from "./countries";

interface EPCountrySelectProps {
  className?: string;
  value?: string;
  onChange?: (code: string) => void;
  defaultCountry?: string;
  priorityCountries?: string;
  placeholder?: string;
  disabled?: boolean;
}

export const epCountrySelectMeta: CodeComponentMeta<EPCountrySelectProps> = {
  name: "plasmic-commerce-ep-country-select",
  displayName: "EP Country Select",
  description:
    "Country dropdown with ISO 3166-1 country codes. Priority countries shown at top with divider.",
  props: {
    value: {
      type: "string",
      displayName: "Value",
      description: "Selected country code (2-letter ISO)",
    },
    onChange: {
      type: "eventHandler" as const,
      argTypes: [{ name: "code", type: "string" }],
    },
    defaultCountry: {
      type: "string",
      defaultValue: "US",
      displayName: "Default Country",
      description: "Default country code when no value is set",
    },
    priorityCountries: {
      type: "string",
      defaultValue: "US,CA,GB,AU",
      displayName: "Priority Countries",
      description:
        "Comma-separated country codes to show at top of the list",
    },
    placeholder: {
      type: "string",
      defaultValue: "Select country",
      displayName: "Placeholder",
    },
    disabled: {
      type: "boolean",
      defaultValue: false,
      displayName: "Disabled",
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPCountrySelect",
};

export function EPCountrySelect(props: EPCountrySelectProps) {
  const {
    className,
    value,
    onChange,
    defaultCountry = "US",
    priorityCountries = "US,CA,GB,AU",
    placeholder = "Select country",
    disabled = false,
  } = props;

  const inEditor = !!usePlasmicCanvasContext();

  const priorityCodes = useMemo(() => {
    if (!priorityCountries) return DEFAULT_PRIORITY_COUNTRIES;
    return priorityCountries
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }, [priorityCountries]);

  const { priority, rest } = useMemo(() => {
    const prioritySet = new Set(priorityCodes);
    const priorityItems = priorityCodes
      .map((code) => COUNTRIES.find((c) => c.code === code))
      .filter(Boolean) as typeof COUNTRIES;
    const restItems = COUNTRIES.filter((c) => !prioritySet.has(c.code));
    return { priority: priorityItems, rest: restItems };
  }, [priorityCodes]);

  const effectiveValue = value ?? defaultCountry;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange?.(e.target.value);
  };

  return (
    <select
      className={className}
      value={effectiveValue}
      onChange={handleChange}
      disabled={disabled || (inEditor && false)}
      aria-label="Country"
      data-ep-country-select=""
    >
      {!effectiveValue && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {priority.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
      {priority.length > 0 && rest.length > 0 && (
        <option disabled>──────────</option>
      )}
      {rest.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function registerEPCountrySelect(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCountrySelectProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPCountrySelect, customMeta ?? epCountrySelectMeta);
}
