import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useId } from "react";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_VARIATIONS } from "../utils/design-time-data";
import { useVariationPicker } from "./VariationPickerContext";

const log = createLogger("EPVariationOptionRadioGroup");

type PreviewState = "auto" | "withOptions";

interface EPVariationOptionRadioGroupProps {
  className?: string;
  itemClassName?: string;
  labelClassName?: string;
  inputClassName?: string;
  groupLabel?: string;
  previewState?: PreviewState;
}

export const epVariationOptionRadioGroupMeta: CodeComponentMeta<EPVariationOptionRadioGroupProps> =
  {
    name: "plasmic-commerce-ep-variation-option-radio-group",
    displayName: "EP Variation Option Radio Group",
    description:
      "Native <input type='radio'> renderer for one variation (e.g. Format). Reads the current variation from context. Must be inside an EP Variation Case (or directly inside an EP Variation Picker).",
    props: {
      itemClassName: {
        type: "string",
        displayName: "Item class",
        description: "CSS class applied to each radio row wrapper.",
        advanced: true,
      },
      labelClassName: {
        type: "string",
        displayName: "Label class",
        description: "CSS class applied to each option's label.",
        advanced: true,
      },
      inputClassName: {
        type: "string",
        displayName: "Input class",
        description: "CSS class applied to each <input> element.",
        advanced: true,
      },
      groupLabel: {
        type: "string",
        displayName: "Accessible Label",
        description:
          "Accessible label for the radio group. Defaults to the variation name.",
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
    importName: "EPVariationOptionRadioGroup",
  };

export function EPVariationOptionRadioGroup(
  props: EPVariationOptionRadioGroupProps
) {
  const {
    className,
    itemClassName,
    labelClassName,
    inputClassName,
    groupLabel,
    previewState = "auto",
  } = props;

  const picker = useVariationPicker();
  const inEditor = !!usePlasmicCanvasContext();
  const reactId = useId();

  const currentVariation = useSelector("currentVariation") as
    | {
        id: string;
        name: string;
        options: { id: string; name: string }[];
      }
    | undefined;

  const mockVariation = MOCK_VARIATIONS[0];
  const useMock =
    previewState === "withOptions" ||
    (previewState === "auto" && !currentVariation && inEditor);

  const effectiveVariation = useMock
    ? {
        id: mockVariation.id,
        name: mockVariation.name,
        options: mockVariation.options,
      }
    : currentVariation;

  if (useMock) {
    log.debug("Using mock variation for design-time preview");
  }

  if (!effectiveVariation?.options) {
    return null;
  }

  const selectedLabel = picker?.selectedValues[effectiveVariation.id];
  const label = groupLabel || effectiveVariation.name;
  const radioName = `variation_${effectiveVariation.id}_${reactId}`;

  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {effectiveVariation.options.map((option) => {
        const id = `${radioName}_${option.name}`;
        const isSelected = selectedLabel === option.name;
        return (
          <div key={option.name} className={itemClassName}>
            <input
              type="radio"
              id={id}
              name={radioName}
              value={option.name}
              checked={isSelected}
              className={inputClassName}
              onChange={() => {
                if (picker && effectiveVariation) {
                  picker.selectOption(effectiveVariation.id, option.name);
                }
              }}
            />
            <label htmlFor={id} className={labelClassName}>
              {option.name}
            </label>
          </div>
        );
      })}
    </div>
  );
}

export function registerEPVariationOptionRadioGroup(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPVariationOptionRadioGroupProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPVariationOptionRadioGroup,
    customMeta ?? epVariationOptionRadioGroupMeta
  );
}
