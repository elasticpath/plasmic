import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_VARIATION_OPTIONS } from "../utils/design-time-data";
import { useRovingTabIndex } from "../utils/useRovingTabIndex";
import { useVariationPicker } from "./VariationPickerContext";

const log = createLogger("EPVariationOptionList");

type PreviewState = "auto" | "withOptions";

interface EPVariationOptionListProps {
  children?: React.ReactNode;
  className?: string;
  selectionMode?: "cards" | "dropdown";
  groupLabel?: string;
  previewState?: PreviewState;
}

export const epVariationOptionListMeta: ComponentMeta<EPVariationOptionListProps> =
  {
    name: "plasmic-commerce-ep-variation-option-list",
    displayName: "EP Variation Option List",
    description:
      "Repeats children for each option value in a variation (e.g. Small, Medium, Large). Must be placed inside an EP Variation Picker.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-variation-option-trigger",
          },
        ],
      },
      selectionMode: {
        type: "choice",
        options: ["cards", "dropdown"],
        defaultValue: "cards",
        displayName: "Selection Mode",
        description:
          "Cards: accessible radio cards. Dropdown: native select for many options.",
      },
      groupLabel: {
        type: "string",
        displayName: "Group Label",
        description:
          "Accessible label for the option group. Defaults to the variation name.",
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
    importName: "EPVariationOptionList",
    providesData: true,
  };

export function EPVariationOptionList(props: EPVariationOptionListProps) {
  const {
    children,
    className,
    selectionMode = "cards",
    groupLabel,
    previewState = "auto",
  } = props;

  const currentVariation = useSelector("currentVariation") as
    | {
        id: string;
        name: string;
        values: { label: string; hexColors?: string[] }[];
      }
    | undefined;

  const inEditor = !!usePlasmicCanvasContext();
  const picker = useVariationPicker();
  const { containerRef, onKeyDown: handleGroupKeyDown } = useRovingTabIndex({
    orientation: "horizontal",
  });

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

  const selectedLabel = picker?.selectedValues[effectiveVariation.id];
  const focusTargetLabel =
    selectedLabel || effectiveVariation.values[0]?.label;
  const label = groupLabel || effectiveVariation.name;

  if (selectionMode === "dropdown") {
    return (
      <div className={className}>
        <select
          value={selectedLabel || ""}
          onChange={(e) => {
            if (picker && effectiveVariation) {
              picker.selectOption(effectiveVariation.id, e.target.value);
            }
          }}
          aria-label={label}
        >
          <option value="" disabled>
            Choose {effectiveVariation.name}...
          </option>
          {effectiveVariation.values.map((option) => (
            <option key={option.label} value={option.label}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleGroupKeyDown}
    >
      {effectiveVariation.values.map((option, i) => {
        const isSelected = selectedLabel === option.label;
        return (
          <DataProvider
            key={option.label}
            name="currentVariationOption"
            data={{
              label: option.label,
              hexColors: option.hexColors,
              isSelected,
            }}
          >
            <DataProvider name="currentVariationOptionIndex" data={i}>
              <DataProvider
                name="optionTriggerA11y"
                data={{
                  isFocusTarget: option.label === focusTargetLabel,
                }}
              >
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          </DataProvider>
        );
      })}
    </div>
  );
}

export function registerEPVariationOptionList(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPVariationOptionListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPVariationOptionList,
    customMeta ?? epVariationOptionListMeta
  );
}
