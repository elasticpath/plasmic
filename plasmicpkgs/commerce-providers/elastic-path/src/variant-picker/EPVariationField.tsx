import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { MOCK_VARIATIONS } from "../utils/design-time-data";

type VariationFieldName = "name" | "id" | "optionCount";

type PreviewState = "auto" | "withData";

interface EPVariationFieldProps {
  field: VariationFieldName;
  className?: string;
  previewState?: PreviewState;
}

export const epVariationFieldMeta: CodeComponentMeta<EPVariationFieldProps> = {
  name: "plasmic-commerce-ep-variation-field",
  displayName: "EP Variation Field",
  description:
    "Displays a field from the current variation (e.g. name, option count). Must be inside an EP Variation Option List or EP Variation Picker.",
  props: {
    field: {
      type: "choice",
      options: [
        { label: "Variation Name", value: "name" },
        { label: "Variation ID", value: "id" },
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
  importName: "EPVariationField",
};

export function EPVariationField(props: EPVariationFieldProps) {
  const { field = "name", className, previewState = "auto" } = props;

  const currentVariation = useSelector("currentVariation") as
    | {
        id: string;
        name: string;
        options: { id: string; name: string }[];
      }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && !currentVariation && inEditor);
  const mockVariation = MOCK_VARIATIONS[0];
  const effectiveVariation = useMock
    ? {
        id: mockVariation.id,
        name: mockVariation.name,
        options: mockVariation.options,
      }
    : currentVariation;

  if (!effectiveVariation) {
    return <span className={className}>—</span>;
  }

  let value: string;
  switch (field) {
    case "name":
      value = effectiveVariation.name;
      break;
    case "id":
      value = effectiveVariation.id;
      break;
    case "optionCount":
      value = String(effectiveVariation.options?.length ?? 0);
      break;
    default:
      value = "";
  }

  return <span className={className}>{value}</span>;
}

export function registerEPVariationField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPVariationFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPVariationField, customMeta ?? epVariationFieldMeta);
}
