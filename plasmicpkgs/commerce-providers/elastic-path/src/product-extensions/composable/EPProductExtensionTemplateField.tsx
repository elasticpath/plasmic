import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_EXTENSION_TEMPLATES } from "../../utils/extensions-mock";
import type { ExtensionTemplate } from "../../types/extensions";

type TemplateFieldName = "slug" | "label" | "fieldCount";
type PreviewState = "auto" | "withData";

interface EPProductExtensionTemplateFieldProps {
  field: TemplateFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epProductExtensionTemplateFieldMeta: CodeComponentMeta<EPProductExtensionTemplateFieldProps> =
  {
    name: "plasmic-commerce-ep-product-extension-template-field",
    displayName: "EP Product Extension Template Field",
    description:
      "Displays a property from the current extension template (slug, label, fieldCount). Must be inside an EP Product Extension Template List.",
    props: {
      field: {
        type: "choice",
        options: [
          { label: "Label (humanized)", value: "label" },
          { label: "Slug (raw key)", value: "slug" },
          { label: "Field Count", value: "fieldCount" },
        ],
        defaultValue: "label",
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
    importName: "EPProductExtensionTemplateField",
    parentComponentName: "plasmic-commerce-ep-product-extension-template-list",
  };

export function EPProductExtensionTemplateField(
  props: EPProductExtensionTemplateFieldProps,
) {
  const { field, className, previewState = "auto" } = props;
  const current = useSelector("currentExtensionTemplate") as
    | ExtensionTemplate
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock = previewState === "withData" || (!current && inEditor);
  const data = useMock ? MOCK_EXTENSION_TEMPLATES[0] : current;
  if (!data) return null;

  let value: unknown;
  if (field === "fieldCount") value = data.fieldCount;
  else value = data[field];

  return <span className={className}>{value == null ? "" : String(value)}</span>;
}

export function registerEPProductExtensionTemplateField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductExtensionTemplateFieldProps>,
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductExtensionTemplateField,
    customMeta ?? epProductExtensionTemplateFieldMeta,
  );
}
