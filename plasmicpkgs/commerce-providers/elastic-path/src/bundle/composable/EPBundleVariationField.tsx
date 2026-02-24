import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import { MOCK_BUNDLE_VARIATIONS, MockBundleVariation } from "./design-time-data";

type BundleVariationFieldName = "name" | "optionCount";

type PreviewState = "auto" | "withData";

interface EPBundleVariationFieldProps {
  field: BundleVariationFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epBundleVariationFieldMeta: ComponentMeta<EPBundleVariationFieldProps> =
  {
    name: "plasmic-commerce-ep-bundle-variation-field",
    displayName: "EP Bundle Variation Field",
    description:
      "Displays a field from the current variation axis (name, option count). Must be inside an EP Bundle Variation Picker.",
    props: {
      field: {
        type: "choice",
        options: [
          { label: "Name", value: "name" },
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
    importName: "EPBundleVariationField",
  };

export function EPBundleVariationField(props: EPBundleVariationFieldProps) {
  const { field, className, previewState = "auto" } = props;

  const currentVariation = useSelector("currentBundleVariation") as
    | MockBundleVariation
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" || (!currentVariation && inEditor);

  const data = useMock ? MOCK_BUNDLE_VARIATIONS[0] : currentVariation;
  if (!data) return null;

  let value: any;
  if (field === "optionCount") {
    value = data.values?.length ?? 0;
  } else {
    value = data[field];
  }

  return <span className={className}>{value ?? ""}</span>;
}

export function registerEPBundleVariationField(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleVariationFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBundleVariationField,
    customMeta ?? epBundleVariationFieldMeta
  );
}
