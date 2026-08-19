import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import type { Product, Variation } from "../types/product";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_EP_PRODUCT } from "../utils/design-time-data";
import {
  VariationPickerContext,
  VariationPickerContextValue,
} from "./VariationPickerContext";
import { findChildProduct, initialSelection } from "./selection";

const log = createLogger("EPVariationPicker");

type PreviewState = "auto" | "withVariations";

interface EPVariationPickerProps {
  children?: React.ReactNode;
  className?: string;
  defaultVariantId?: string;
  updateUrlOnChange?: boolean;
  previewState?: PreviewState;
}

export const epVariationPickerMeta: CodeComponentMeta<EPVariationPickerProps> = {
  name: "plasmic-commerce-ep-variation-picker",
  displayName: "EP Variation Picker",
  description:
    "Container for product variant selection. Repeats children for each variation dimension (e.g. Size, Color). Must be placed inside a Product Box.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-variation-case",
        },
      ],
    },
    defaultVariantId: {
      type: "string",
      description: "Pre-select a variant by ID (e.g. from URL query param)",
      advanced: true,
    },
    updateUrlOnChange: {
      type: "boolean",
      defaultValue: true,
      description: "Update the URL query parameter when variant changes",
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withVariations"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPVariationPicker",
  providesData: true,
};

/**
 * Resolve which variant ID to use for initial selection.
 * Priority: explicit prop > URL ?variant= param > __initialVariantId from fetcher
 */
function resolveInitialVariantId(
  prop: string | undefined,
  product: Product | undefined
): string | undefined {
  if (prop) return prop;

  if (typeof window !== "undefined") {
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get("variant");
      if (fromUrl) return fromUrl;
    } catch {
      // ignore
    }
  }

  return (product as Product & { __initialVariantId?: string })?.__initialVariantId;
}

export function EPVariationPicker(props: EPVariationPickerProps) {
  const {
    children,
    className,
    defaultVariantId,
    updateUrlOnChange = true,
    previewState = "auto",
  } = props;

  const product = useSelector("currentProduct") as Product | undefined;
  const form = useFormContext();
  const inEditor = !!usePlasmicCanvasContext();

  const useMock =
    previewState === "withVariations" ||
    (previewState === "auto" &&
      !product?.variations?.length &&
      inEditor);

  const effectiveProduct = useMock ? MOCK_EP_PRODUCT : product;
  const variations: Variation[] = effectiveProduct?.variations || [];

  if (useMock) {
    log.debug("Using mock product for design-time preview");
  }

  const resolvedDefaultVariantId = useMemo(
    () => resolveInitialVariantId(defaultVariantId, effectiveProduct),
    [defaultVariantId, effectiveProduct]
  );

  const [selectedValues, setSelectedValues] = useState<Record<string, string>>(
    {}
  );
  const [lastInitializedVariantId, setLastInitializedVariantId] = useState<
    string | undefined
  >(undefined);
  const [claimedVariations, setClaimedVariations] = useState<Set<string>>(
    () => new Set<string>()
  );

  const registerClaim = useCallback((variationName: string) => {
    setClaimedVariations((prev) => {
      if (prev.has(variationName)) return prev;
      const next = new Set(prev);
      next.add(variationName);
      return next;
    });
    return () => {
      setClaimedVariations((prev) => {
        if (!prev.has(variationName)) return prev;
        const next = new Set(prev);
        next.delete(variationName);
        return next;
      });
    };
  }, []);

  // Initialize from resolved default variant ID — or fall back to first variant
  // when none is supplied, so trigger highlights match the auto-selected variant
  // exposed via the URL writer below.
  useEffect(() => {
    if (!effectiveProduct?.childProducts?.length) return;
    if (Object.keys(selectedValues).length > 0) return;

    const targetId =
      resolvedDefaultVariantId ?? effectiveProduct.childProducts[0]?.id;
    if (!targetId || targetId === lastInitializedVariantId) return;

    const initialValues = initialSelection(effectiveProduct, targetId);
    if (Object.keys(initialValues).length === 0) return;

    setSelectedValues(initialValues);
    setLastInitializedVariantId(targetId);
  }, [
    resolvedDefaultVariantId,
    effectiveProduct,
    lastInitializedVariantId,
    selectedValues,
  ]);

  const selectOption = useCallback(
    (variationId: string, optionLabel: string) => {
      setSelectedValues((prev) => ({
        ...prev,
        [variationId]: optionLabel,
      }));
    },
    []
  );

  // Sync selection to form fields (skip when using mock data)
  useEffect(() => {
    if (!form || useMock) return;
    Object.entries(selectedValues).forEach(([variationId, value]) => {
      const currentFormValue = form.getValues(`variation_${variationId}`);
      if (currentFormValue !== value) {
        form.setValue(`variation_${variationId}`, value);
      }
    });
  }, [selectedValues, form, useMock]);

  // Find matching variant based on all selections
  const selectedVariant = useMemo(
    () =>
      variations.length === 0
        ? undefined
        : findChildProduct(effectiveProduct, selectedValues),
    [effectiveProduct, variations, selectedValues]
  );

  // Update ProductVariant form field and URL when variant changes (skip mock)
  useEffect(() => {
    if (useMock) return;
    if (selectedVariant && form) {
      const currentValue = form.getValues("ProductVariant");
      if (currentValue !== selectedVariant.id) {
        form.setValue("ProductVariant", selectedVariant.id);
        if (updateUrlOnChange && typeof window !== "undefined") {
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("variant", String(selectedVariant.id));
            window.history.replaceState({}, "", url.toString());
          } catch {
            // Silently fail in non-browser environments
          }
        }
      }
    }
  }, [selectedVariant?.id, selectedValues, updateUrlOnChange, form, useMock]);

  const contextValue: VariationPickerContextValue = useMemo(
    () => ({
      selectedValues,
      selectOption,
      selectedVariant,
      claimedVariations,
      registerClaim,
    }),
    [selectedValues, selectOption, selectedVariant, claimedVariations, registerClaim]
  );

  if (!variations || variations.length === 0) {
    return null;
  }

  return (
    <VariationPickerContext.Provider value={contextValue}>
      <div className={className}>
        {variations.map((variation, i) => (
          <DataProvider
            key={variation.id}
            name="currentVariation"
            data={variation}
          >
            <DataProvider name="currentVariationIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        ))}
      </div>
    </VariationPickerContext.Provider>
  );
}

export function registerEPVariationPicker(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPVariationPickerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPVariationPicker, customMeta ?? epVariationPickerMeta);
}
