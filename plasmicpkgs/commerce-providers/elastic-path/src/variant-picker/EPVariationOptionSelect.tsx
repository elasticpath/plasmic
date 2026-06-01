import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_VARIATION_OPTIONS } from "../utils/design-time-data";
import { useVariationPicker } from "./VariationPickerContext";

const log = createLogger("EPVariationOptionSelect");

type PreviewState = "auto" | "withOptions";

interface EPVariationOptionSelectProps {
  className?: string;
  groupLabel?: string;
  placeholder?: string;
  previewState?: PreviewState;
}

export const epVariationOptionSelectMeta: CodeComponentMeta<EPVariationOptionSelectProps> =
  {
    name: "plasmic-commerce-ep-variation-option-select",
    displayName: "EP Variation Option Select",
    description:
      "Native <select> renderer for one variation (e.g. Language). Reads the current variation from context. Must be inside an EP Variation Case (or directly inside an EP Variation Picker).",
    props: {
      groupLabel: {
        type: "string",
        displayName: "Accessible Label",
        description:
          "Accessible label for the select. Defaults to the variation name.",
        advanced: true,
      },
      placeholder: {
        type: "string",
        displayName: "Placeholder",
        description:
          "Text for the empty/disabled placeholder option. Defaults to 'Choose {variation name}...'.",
        advanced: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withOptions"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPVariationOptionSelect",
  };

export function EPVariationOptionSelect(props: EPVariationOptionSelectProps) {
  const { className, groupLabel, placeholder, previewState = "auto" } = props;

  const picker = useVariationPicker();
  const inEditor = !!usePlasmicCanvasContext();

  const currentVariation = useSelector("currentVariation") as
    | {
        id: string;
        name: string;
        values: { label: string; hexColors?: string[] }[];
      }
    | undefined;

  const mockVariation = MOCK_VARIATION_OPTIONS[0];
  const useMock =
    previewState === "withOptions" ||
    (previewState === "auto" && !currentVariation && inEditor);

  const effectiveVariation = useMock
    ? {
        id: mockVariation.id,
        name: mockVariation.displayName,
        values: mockVariation.values,
      }
    : currentVariation;

  if (useMock) {
    log.debug("Using mock variation for design-time preview");
  }

  if (!effectiveVariation?.values) {
    return null;
  }

  const selectedLabel = picker?.selectedValues[effectiveVariation.id] ?? "";
  const label = groupLabel || effectiveVariation.name;
  const placeholderText = placeholder || `Choose ${effectiveVariation.name}...`;

  return (
    <select
      className={className}
      style={CHEVRON_STYLE}
      value={selectedLabel}
      aria-label={label}
      onChange={(e) => {
        if (picker && effectiveVariation) {
          picker.selectOption(effectiveVariation.id, e.target.value);
        }
      }}
    >
      <option value="" disabled>
        {placeholderText}
      </option>
      {effectiveVariation.values.map((option) => (
        <option key={option.label} value={option.label}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Custom chevron survives Tailwind/normalize.css `appearance: none` resets.
const CHEVRON_SVG =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const CHEVRON_STYLE: React.CSSProperties = {
  backgroundImage: `url("${CHEVRON_SVG}")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "10px 6px",
};

export function registerEPVariationOptionSelect(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPVariationOptionSelectProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPVariationOptionSelect,
    customMeta ?? epVariationOptionSelectMeta
  );
}
