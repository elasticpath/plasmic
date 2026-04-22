import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { useVariationPicker } from "./VariationPickerContext";

const log = createLogger("EPVariationOptionTrigger");

type PreviewState = "auto" | "selected" | "unselected";

interface EPVariationOptionTriggerProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epVariationOptionTriggerMeta: CodeComponentMeta<EPVariationOptionTriggerProps> =
  {
    name: "plasmic-commerce-ep-variation-option-trigger",
    displayName: "EP Variation Option Trigger",
    description:
      "Clickable element that selects a variation option. Place your button or swatch design inside. Must be inside an EP Variation Option List.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-variation-option-field",
            props: { field: "label" },
          },
        ],
      },
      previewState: {
        type: "choice",
        options: ["auto", "selected", "unselected"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPVariationOptionTrigger",
  };

export function EPVariationOptionTrigger(
  props: EPVariationOptionTriggerProps
) {
  const { children, className, previewState = "auto" } = props;

  const currentVariation = useSelector("currentVariation") as
    | { id: string; name: string }
    | undefined;

  const currentOption = useSelector("currentVariationOption") as
    | { label: string; hexColors?: string[]; isSelected: boolean }
    | undefined;

  const a11y = useSelector("optionTriggerA11y") as
    | { isFocusTarget: boolean }
    | undefined;

  const inEditor = !!usePlasmicCanvasContext();
  const picker = useVariationPicker();

  const useMock =
    previewState !== "auto" ||
    (!currentOption && inEditor);

  const effectiveVariation = currentVariation ?? (useMock
    ? { id: "sample-color", name: "Sample Color" }
    : undefined);

  const effectiveOption = currentOption ?? (useMock
    ? {
        label: "Midnight Blue",
        hexColors: ["#191970"] as string[],
        isSelected: previewState === "selected",
      }
    : undefined);

  if (useMock) {
    log.debug("Using mock option for design-time preview", {
      previewState,
    } as Record<string, unknown>);
  }

  const isSelected = previewState !== "auto"
    ? previewState === "selected"
    : (effectiveOption?.isSelected ?? false);
  const isFocusTarget = a11y?.isFocusTarget ?? isSelected;

  const handleSelect = () => {
    if (picker && currentVariation && currentOption) {
      picker.selectOption(currentVariation.id, currentOption.label);
    }
  };

  return (
    <div
      className={className}
      onClick={handleSelect}
      role="radio"
      aria-checked={isSelected}
      tabIndex={isFocusTarget ? 0 : -1}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSelect();
        }
      }}
      aria-label={effectiveOption?.label}
      data-selected={isSelected || undefined}
    >
      {children}
    </div>
  );
}

export function registerEPVariationOptionTrigger(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPVariationOptionTriggerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPVariationOptionTrigger,
    customMeta ?? epVariationOptionTriggerMeta
  );
}
