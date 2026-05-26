import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_EXTENSION_TEMPLATES } from "./design-time-data";
import type { ExtensionField } from "./types";

type FieldName = "key" | "label" | "value" | "displayValue" | "type";
type PreviewState = "auto" | "withData";

interface EPProductExtensionFieldProps {
  field: FieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epProductExtensionFieldMeta: CodeComponentMeta<EPProductExtensionFieldProps> =
  {
    name: "plasmic-commerce-ep-product-extension-field",
    displayName: "EP Product Extension Field",
    description:
      "Displays a property of the current extension field (label, displayValue, value, key, type). Must be inside an EP Product Extension Field List.",
    props: {
      field: {
        type: "choice",
        options: [
          { label: "Label (humanized key)", value: "label" },
          { label: "Display Value (formatted)", value: "displayValue" },
          { label: "Value (raw)", value: "value" },
          { label: "Key (raw)", value: "key" },
          { label: "Type", value: "type" },
        ],
        defaultValue: "displayValue",
        displayName: "Field",
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPProductExtensionField",
    parentComponentName: "plasmic-commerce-ep-product-extension-field-list",
  };

export function EPProductExtensionField(props: EPProductExtensionFieldProps) {
  const { field, className, previewState = "auto" } = props;
  const current = useSelector("currentExtensionField") as
    | ExtensionField
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock = previewState === "withData" || (!current && inEditor);
  const data = useMock ? MOCK_EXTENSION_TEMPLATES[0]?.fields[0] : current;
  if (!data) return null;

  let rendered: string;
  switch (field) {
    case "label":
      rendered = data.label;
      break;
    case "key":
      rendered = data.key;
      break;
    case "type":
      rendered = data.type;
      break;
    case "displayValue":
      rendered = data.displayValue;
      break;
    case "value":
    default:
      rendered = stringifyValue(data.value);
      break;
  }

  return <span className={className}>{rendered}</span>;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function registerEPProductExtensionField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductExtensionFieldProps>,
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductExtensionField,
    customMeta ?? epProductExtensionFieldMeta,
  );
}
