import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_BUNDLE_COMPONENTS } from "./design-time-data";

type BundleOptionFieldName =
  | "name"
  | "price"
  | "imageUrl"
  | "quantity"
  | "isSelected"
  | "sku"
  | "description"
  | "isDefault"
  | "isParentProduct";

type PreviewState = "auto" | "withData";

interface EPBundleOptionFieldProps {
  field: BundleOptionFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleOptionFieldMeta: CodeComponentMeta<EPBundleOptionFieldProps> = {
  name: "plasmic-commerce-ep-bundle-option-field",
  displayName: "EP Bundle Option Field",
  description:
    "Displays a field from the current bundle option (name, price, image, etc.). Must be inside an EP Bundle Option List.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Name", value: "name" },
        { label: "Price", value: "price" },
        { label: "Image URL", value: "imageUrl" },
        { label: "Quantity", value: "quantity" },
        { label: "Is Selected", value: "isSelected" },
        { label: "SKU", value: "sku" },
        { label: "Description", value: "description" },
        { label: "Is Default", value: "isDefault" },
        { label: "Is Parent Product", value: "isParentProduct" },
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
  importName: "EPBundleOptionField",
  parentComponentName: "plasmic-commerce-ep-bundle-option-list",
};

export function EPBundleOptionField(props: EPBundleOptionFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const currentOption = useSelector("currentBundleOption") as
    | Record<string, any>
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!currentOption && inEditor);

  const data = useMock ? MOCK_BUNDLE_COMPONENTS[0].options[0] : currentOption;
  if (!data) return null;

  let value: any = data[field];

  // Boolean fields get string representation
  if (typeof value === "boolean") {
    value = value ? "true" : "false";
  }

  return <span className={className}>{value ?? ""}</span>;
}

export function registerEPBundleOptionField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPBundleOptionFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleOptionField,
    customMeta ?? epBundleOptionFieldMeta
  );
}
