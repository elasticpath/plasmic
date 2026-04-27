import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";

type OptionFieldName = "label";

interface EPVariationOptionFieldProps {
  field: OptionFieldName;
  className?: string;
}

export const epVariationOptionFieldMeta: CodeComponentMeta<EPVariationOptionFieldProps> =
  {
    name: "plasmic-commerce-ep-variation-option-field",
    displayName: "EP Variation Option Field",
    description:
      "Displays a field from the current variation option (e.g. the option label). Must be inside an EP Variation Option List.",
    props: {
      field: {
        type: "choice",
        options: [{ label: "Label", value: "label" }],
        defaultValue: "label",
        displayName: "Field",
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPVariationOptionField",
  };

export function EPVariationOptionField(props: EPVariationOptionFieldProps) {
  const { field = "label", className } = props;

  const currentOption = useSelector("currentVariationOption") as
    | { label: string; hexColors?: string[]; isSelected: boolean }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const effectiveOption =
    currentOption ?? (inEditor ? { label: "Sample Option" } : undefined);

  if (!effectiveOption) {
    return <span className={className}>—</span>;
  }

  return <span className={className}>{effectiveOption.label}</span>;
}

export function registerEPVariationOptionField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPVariationOptionFieldProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPVariationOptionField,
    customMeta ?? epVariationOptionFieldMeta
  );
}
