import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_BUNDLE_COMPONENTS } from "./design-time-data";

type BundleComponentFieldName =
  | "name"
  | "min"
  | "max"
  | "selectedCount"
  | "isValid"
  | "optionCount";

type PreviewState = "auto" | "withData";

interface EPBundleComponentFieldProps {
  field: BundleComponentFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleComponentFieldMeta: ComponentMeta<EPBundleComponentFieldProps> =
  {
    name: "plasmic-commerce-ep-bundle-component-field",
    displayName: "EP Bundle Component Field",
    description:
      "Displays a field from the current bundle component (name, min, max, etc.). Must be inside an EP Bundle Component List.",
    props: {
      field: {
        type: "choice",
        options: [
          { label: "Name", value: "name" },
          { label: "Min Selections", value: "min" },
          { label: "Max Selections", value: "max" },
          { label: "Selected Count", value: "selectedCount" },
          { label: "Is Valid", value: "isValid" },
          { label: "Option Count", value: "optionCount" },
        ],
        defaultValue: "name",
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
    importName: "EPBundleComponentField",
  };

export function EPBundleComponentField(props: EPBundleComponentFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const currentComponent = useSelector("currentBundleComponent") as
    | Record<string, any>
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!currentComponent && inEditor);

  const data = useMock ? MOCK_BUNDLE_COMPONENTS[0] : currentComponent;
  if (!data) return null;

  let value: any;
  if (field === "optionCount") {
    value = data.options?.length ?? 0;
  } else {
    value = data[field];
  }

  // Boolean fields get string representation
  if (typeof value === "boolean") {
    value = value ? "true" : "false";
  }

  return <span className={className}>{value ?? ""}</span>;
}

export function registerEPBundleComponentField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleComponentFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleComponentField,
    customMeta ?? epBundleComponentFieldMeta
  );
}
