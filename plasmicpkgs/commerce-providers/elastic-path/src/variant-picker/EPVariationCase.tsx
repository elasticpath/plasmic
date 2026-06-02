import { useSelector, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect } from "react";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { useVariationPicker } from "./VariationPickerContext";

const log = createLogger("EPVariationCase");

interface EPVariationCaseProps {
  children?: React.ReactNode;
  className?: string;
  forVariation?: string;
}

export const epVariationCaseMeta: CodeComponentMeta<EPVariationCaseProps> = {
  name: "plasmic-commerce-ep-variation-case",
  displayName: "EP Variation Case",
  description:
    "Slot host scoped to one variation (e.g. Language, Format). Set 'For variation' to render only when iterating that variation. Leave blank to render as the fallback for variations not handled by any sibling. Must be inside an EP Variation Picker.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "vbox",
          styles: { gap: "8px", padding: "4px 0" },
          children: [
            {
              type: "component",
              name: "plasmic-commerce-ep-variation-field",
              props: { field: "name" },
            },
            {
              type: "component",
              name: "plasmic-commerce-ep-variation-option-list",
            },
          ],
        },
      ],
    },
    forVariation: {
      type: "string",
      displayName: "For variation",
      description:
        "Variation name (matches the variation's display name in EP, e.g. 'Language', 'Format'). Leave blank to make this the fallback for any variation not handled by a sibling.",
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPVariationCase",
};

export function EPVariationCase(props: EPVariationCaseProps) {
  const { children, className, forVariation } = props;

  const picker = useVariationPicker();
  const currentVariation = useSelector("currentVariation") as
    | { id: string; name: string }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const trimmedForVariation = forVariation?.trim();
  const isKeyed = !!trimmedForVariation;

  const registerClaim = picker?.registerClaim;
  useEffect(() => {
    if (!isKeyed || !registerClaim) return;
    return registerClaim(trimmedForVariation!);
  }, [isKeyed, trimmedForVariation, registerClaim]);

  if (inEditor && !currentVariation) {
    // Show children at design time when not inside a real picker iteration,
    // so the designer can see and edit the slot content.
    return <div className={className}>{children}</div>;
  }

  if (!currentVariation || !picker) {
    return null;
  }

  const shouldRender = isKeyed
    ? currentVariation.name === trimmedForVariation
    : !picker.claimedVariations.has(currentVariation.name);

  if (!shouldRender) {
    log.debug("Skipping variation", {
      forVariation: trimmedForVariation ?? "(fallback)",
      currentVariation: currentVariation.name,
      claimedVariations: Array.from(picker.claimedVariations),
    } as Record<string, unknown>);
    return null;
  }

  return <div className={className}>{children}</div>;
}

export function registerEPVariationCase(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPVariationCaseProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPVariationCase, customMeta ?? epVariationCaseMeta);
}
