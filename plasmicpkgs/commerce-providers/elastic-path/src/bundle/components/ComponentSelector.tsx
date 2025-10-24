import React from "react";
import { ComponentProduct } from "../types";
import { ParentProductInfo } from "../use-parent-products";
import { OptionProduct } from "../use-bundle-option-products";
import { sortByOrder } from "../utils/bundleSelectionUtils";
import { OptionSelector } from "./OptionSelector";
import { ParentProductOption } from "./ParentProductOption";

interface ComponentSelectorProps {
  componentKey: string;
  component: ComponentProduct;
  selectedOptions: Record<string, number>;
  onSelectionChange: (componentKey: string, optionId: string, quantity: number, variationId?: string) => void;
  optionProducts: Record<string, OptionProduct>;
  productsLoading: boolean;
  isFixedPrice: boolean;
  parentProducts: Record<string, ParentProductInfo>;
}

export function ComponentSelector({
  componentKey,
  component,
  selectedOptions,
  onSelectionChange,
  optionProducts,
  productsLoading,
  isFixedPrice,
  parentProducts,
}: ComponentSelectorProps) {
  const selectedCount = Object.values(selectedOptions).reduce((sum, qty) => sum + qty, 0);
  const isRequired = component.min !== undefined && component.min !== null && component.min > 0;
  const isSingleSelect = component.min === 1 && component.max === 1;
  const isOptional = component.min === 0 || component.min === null;

  return (
    <div style={{ marginBottom: "20px", padding: "10px", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
      <h3 style={{ marginTop: 0 }}>
        {component.name || `Component ${componentKey}`} 
        {isRequired && <span style={{ color: "#d32f2f" }}> *</span>}
        {isOptional && <span style={{ fontSize: "0.8em", color: "#666" }}> (Optional)</span>}
      </h3>
      
      {component.min !== undefined && component.min !== null && (
        <p style={{ fontSize: "0.9em", color: "#666" }}>
          {component.min === component.max
            ? `Select exactly ${component.min}`
            : component.max !== null && component.max !== undefined
            ? `Select ${component.min} to ${component.max}`
            : `Select at least ${component.min}`}
          {" "}(Currently: {selectedCount})
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {sortByOrder(component.options || []).map((option, index) => {
          const optionId = option.id || `option-${index}`;
          const parentInfo = parentProducts[optionId];
          
          // For parent products, we need to handle variations
          if (parentInfo?.isParent) {
            return (
              <ParentProductOption
                key={optionId}
                option={option}
                optionId={optionId}
                parentInfo={parentInfo}
                componentKey={componentKey}
                selectedOptions={selectedOptions}
                onSelectionChange={onSelectionChange}
                optionProducts={optionProducts}
                isFixedPrice={isFixedPrice}
                isSingleSelect={isSingleSelect}
              />
            );
          }

          // Regular simple product option
          return (
            <OptionSelector
              key={optionId}
              option={option}
              index={index}
              componentKey={componentKey}
              selectedOptions={selectedOptions}
              onSelectionChange={(componentKey, optionId, quantity) => 
                onSelectionChange(componentKey, optionId, quantity)
              }
              optionProducts={optionProducts}
              productsLoading={productsLoading}
              isFixedPrice={isFixedPrice}
              isSingleSelect={isSingleSelect}
            />
          );
        })}
      </div>
    </div>
  );
}