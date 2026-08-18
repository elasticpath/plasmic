import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import type { Product, Variation } from "./types/product";
import React, { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useFormContext } from "react-hook-form";
import { Registerable } from "./registerable";
import {
  findChildProduct,
  initialSelection,
} from "./variant-picker/selection";
import { createLogger } from "./utils/logger";

const log = createLogger("EPProductVariantPicker");

interface EPProductVariantPickerProps {
  className?: string;
  defaultVariantId?: string; // Pre-select a specific variant (e.g., from URL params)
  updateUrlOnChange?: boolean; // Whether to update the URL when variant changes
}

export const epProductVariantPickerMeta: CodeComponentMeta<EPProductVariantPickerProps> =
  {
    name: "plasmic-commerce-ep-product-variant-picker",
    displayName: "EP Product Variant Picker",
    description:
      "Elastic Path variant picker supporting multiple variation dimensions",
    props: {
      defaultVariantId: {
        type: "string",
        description:
          "Pre-select a specific variant by ID (e.g., from URL query params)",
      },
      updateUrlOnChange: {
        type: "boolean",
        description:
          "Update the URL query parameter when variant selection changes",
        defaultValue: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPProductVariantPicker",
  };

export function EPProductVariantPicker(props: EPProductVariantPickerProps) {
  const { className, defaultVariantId, updateUrlOnChange } = props;

  // Access product from Plasmic's data context
  const product = useSelector("currentProduct") as Product | undefined;
  const form = useFormContext() ?? useForm();

  // Extract variations from the product
  const variations: Variation[] = product?.variations || [];

  // Track the last initialized variant ID
  const [lastInitializedVariantId, setLastInitializedVariantId] = useState<string | undefined>(undefined);

  // Set initial values based on defaultVariantId
  useEffect(() => {
    if (
      defaultVariantId &&
      defaultVariantId !== lastInitializedVariantId &&
      product?.childProducts &&
      form
    ) {
      const selection = initialSelection(product, defaultVariantId);
      if (Object.keys(selection).length > 0) {
        Object.entries(selection).forEach(([variationId, optionName]) => {
          form.setValue(`variation_${variationId}`, optionName);
        });
        setLastInitializedVariantId(defaultVariantId);
      }
    }
  }, [defaultVariantId, product, form, lastInitializedVariantId]);

  // Watch all variation selections
  const watchedValues = variations.map((v) => form?.watch(`variation_${v.id}`));

  const variationValues = useMemo(() => {
    const values = variations.reduce<Record<string, string>>(
      (acc, variation, index) => {
        const watchValue = watchedValues[index];
        if (watchValue) {
          acc[variation.id] = watchValue;
        }
        return acc;
      },
      {}
    );
    return values;
  }, [variations, ...watchedValues]);

  // Find the matching child product based on selected options
  const selectedVariant = useMemo(() => {
    if (Object.keys(variationValues).length !== variations.length) {
      return undefined;
    }
    return findChildProduct(product, variationValues);
  }, [product, variations, variationValues]);

  // Update the ProductVariant field when a matching variant is found
  useEffect(() => {
    if (selectedVariant && form) {
      const currentValue = form.getValues("ProductVariant");
      // Only update if the value actually changed to prevent infinite loops
      if (currentValue !== selectedVariant.id) {
        form.setValue("ProductVariant", selectedVariant.id);
        
        // Update URL if enabled and we're in a browser environment
        if (updateUrlOnChange && typeof window !== 'undefined') {
          try {
            const url = new URL(window.location.href);
            url.searchParams.set('variant', String(selectedVariant.id));
            window.history.replaceState({}, '', url.toString());
          } catch (error) {
            log.error("Failed to update URL", { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>);
          }
        }
      }
    }
  }, [selectedVariant?.id, variationValues, updateUrlOnChange]); // form is stable from useFormContext

  // If no variations, return null
  if (!variations || variations.length === 0) {
    return <div className={className}>No variations available</div>;
  }

  return (
    <div className={className}>
      {variations.map((variation) => (
        <div key={variation.id} style={{ marginBottom: "10px" }}>
          <label style={{ display: "block", marginBottom: "5px" }}>
            {variation.name}
          </label>
          <Controller
            name={`variation_${variation.id}`}
            control={form?.control}
            defaultValue=""
            render={({ field }) => (
              <select {...field} style={{ width: "100%" }}>
                <option value="">Select {variation.name}</option>
                {variation.options.map((option) => (
                  <option key={option.id} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
      ))}
      {selectedVariant && (
        <div style={{ marginTop: "10px", fontSize: "0.9em", color: "#666" }}>
          Selected: {selectedVariant.name}
        </div>
      )}
    </div>
  );
}

export function registerEPProductVariantPicker(
  loader?: Registerable,
  customEPProductVariantPickerMeta?: CodeComponentMeta<EPProductVariantPickerProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductVariantPicker,
    customEPProductVariantPickerMeta ?? epProductVariantPickerMeta
  );
}
