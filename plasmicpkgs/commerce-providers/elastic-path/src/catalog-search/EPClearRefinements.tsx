/**
 * EPClearRefinements — single-click clear-all-filters control.
 *
 * Wraps `useClearRefinements()` from react-instantsearch. Pre-wires onClick
 * and `disabled` into a single child element via Pattern C (cloneElement),
 * so designers drop the component and it works without extra Studio
 * interaction wiring. Multi-element children fall through unchanged — the
 * `clearRefinementsData.clear` context value is the documented escape
 * hatch when auto-injection can't apply.
 */

import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle, useMemo } from "react";
import { Registerable } from "../registerable";
import {
  MOCK_CLEAR_REFINEMENTS_DATA,
  ClearRefinementsData,
} from "./design-time-data";

type PreviewState = "auto" | "withData";

interface EPClearRefinementsProps {
  children?: React.ReactNode;
  includedAttributes?: string[];
  excludedAttributes?: string[];
  alwaysRender?: boolean;
  className?: string;
  previewState?: PreviewState;
}

interface EPClearRefinementsActions {
  clear(): void;
}

export const epClearRefinementsMeta: CodeComponentMeta<EPClearRefinementsProps> = {
  name: "plasmic-commerce-ep-clear-refinements",
  displayName: "EP Clear Refinements",
  description:
    "Drops a single button that clears all active filters in one click. Click + disabled state are wired automatically. Must be inside EP Catalog Search Provider.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "button",
          value: "Clear all",
        },
      ],
    },
    includedAttributes: {
      type: "array",
      displayName: "Included Attributes",
      description:
        "Restrict which attributes the clear action affects. Mutually exclusive with Excluded Attributes.",
    },
    excludedAttributes: {
      type: "array",
      displayName: "Excluded Attributes",
      description:
        "Attributes to leave alone when clearing. Mutually exclusive with Included Attributes.",
    },
    alwaysRender: {
      type: "boolean",
      displayName: "Always Render",
      description:
        "Keep rendering children when there is nothing to clear (default hides them). Use for always-visible controls like an \"All results\" scope pill — style the active state off $ctx.clearRefinementsData.canRefine (false = no refinements = \"all\" is selected).",
      defaultValue: false,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPClearRefinements",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
  providesData: true,
  refActions: {
    clear: {
      description: "Trigger the clear-all action programmatically",
      argTypes: [],
    },
  },
};

export const EPClearRefinements = React.forwardRef<
  EPClearRefinementsActions,
  EPClearRefinementsProps
>(function EPClearRefinements(props, ref) {
  const {
    children,
    includedAttributes,
    excludedAttributes,
    alwaysRender = false,
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <MockClearRefinements ref={ref} className={className}>
        {children}
      </MockClearRefinements>
    );
  }

  return (
    <EPClearRefinementsInner
      ref={ref}
      includedAttributes={includedAttributes}
      excludedAttributes={excludedAttributes}
      alwaysRender={alwaysRender}
      className={className}
    >
      {children}
    </EPClearRefinementsInner>
  );
});

const MockClearRefinements = React.forwardRef<
  EPClearRefinementsActions,
  { children?: React.ReactNode; className?: string }
>(function MockClearRefinements({ children, className }, ref) {
  useImperativeHandle(ref, () => ({
    clear: () => {},
  }));

  return (
    <DataProvider
      name="clearRefinementsData"
      data={MOCK_CLEAR_REFINEMENTS_DATA}
    >
      <div
        className={className}
        data-ep-clear-refinements=""
        onClick={() => {}}
      >
        {children}
      </div>
    </DataProvider>
  );
});

const EPClearRefinementsInner = React.forwardRef<
  EPClearRefinementsActions,
  {
    children?: React.ReactNode;
    includedAttributes?: string[];
    excludedAttributes?: string[];
    alwaysRender?: boolean;
    className?: string;
  }
>(function EPClearRefinementsInner(
  { children, includedAttributes, excludedAttributes, alwaysRender, className },
  ref
) {
  const { useClearRefinements } = require("react-instantsearch");
  const { refine, canRefine } = useClearRefinements({
    includedAttributes,
    excludedAttributes,
  });

  const handleClear = useCallback(() => {
    refine();
  }, [refine]);

  useImperativeHandle(ref, () => ({
    clear: handleClear,
  }));

  const data: ClearRefinementsData = useMemo(
    () => ({ canRefine, clear: handleClear }),
    [canRefine, handleClear]
  );

  const handleWrapperClick = useCallback(() => {
    if (canRefine) refine();
  }, [refine, canRefine]);

  // Default behavior hides the control when there's nothing to clear;
  // alwaysRender keeps it for always-visible "All results"-style pills.
  if (!canRefine && !alwaysRender) return null;

  return (
    <DataProvider name="clearRefinementsData" data={data}>
      <div
        className={className}
        data-ep-clear-refinements=""
        onClick={handleWrapperClick}
      >
        {children}
      </div>
    </DataProvider>
  );
});

export function registerEPClearRefinements(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPClearRefinementsProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPClearRefinements,
    customMeta ?? epClearRefinementsMeta
  );
}
