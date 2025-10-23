import React, { useState } from "react";
import { ComponentProduct } from "../types";
import { ParentProductInfo } from "../use-parent-products";
import { OptionProduct } from "../use-bundle-option-products";
import { VariationSelector } from "./VariationSelector";

interface ParentProductOptionProps {
  option: NonNullable<ComponentProduct["options"]>[0];
  optionId: string;
  parentInfo: ParentProductInfo;
  componentKey: string;
  selectedOptions: Record<string, number>;
  onSelectionChange: (componentKey: string, optionId: string, quantity: number, variationId?: string) => void;
  optionProducts: Record<string, OptionProduct>;
  isFixedPrice: boolean;
  isSingleSelect: boolean;
}

export const ParentProductOption = React.memo(function ParentProductOption({
  option,
  optionId,
  parentInfo,
  componentKey,
  selectedOptions,
  onSelectionChange,
  optionProducts,
  isFixedPrice,
  isSingleSelect,
}: ParentProductOptionProps) {
  const [showVariations, setShowVariations] = useState(false);
  
  // Get parent product details for variation metadata
  const parentProduct = optionProducts[optionId];
  
  // Check if any variation of this parent is selected
  const hasSelection = Object.keys(selectedOptions).some(key => key.startsWith(`${optionId}:`));
  
  // Get the currently selected variation
  const selectedVariationKey = Object.keys(selectedOptions).find(key => 
    key.startsWith(`${optionId}:`) && selectedOptions[key] > 0
  );
  const selectedVariationId = selectedVariationKey?.split(':')[1];
  const selectedVariation = parentInfo.children?.find(child => child.id === selectedVariationId);

  return (
    <div style={{ border: "1px solid #e0e0e0", borderRadius: "4px", padding: "10px" }}>
      {/* Parent product header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
        <input
          type={isSingleSelect ? "radio" : "checkbox"}
          name={isSingleSelect ? `component-${componentKey}` : undefined}
          checked={hasSelection}
          onChange={(e) => {
            e.stopPropagation();
            if (e.target.checked) {
              setShowVariations(true);
              // Select first available (non-excluded) variation if none selected
              if (!hasSelection) {
                const firstAvailableChild = parentInfo.children?.find(child => !child.excluded);
                if (firstAvailableChild) {
                  onSelectionChange(componentKey, optionId, 1, firstAvailableChild.id);
                }
              }
            } else {
              // Deselect all variations
              setShowVariations(false);
              if (selectedVariationKey) {
                onSelectionChange(componentKey, optionId, 0, selectedVariationId);
              }
            }
          }}
        />
        <label style={{ flex: 1, fontWeight: "bold" }}>
          {parentProduct?.name || optionId}
          <span style={{ fontSize: "0.8em", color: "#666", fontWeight: "normal" }}> (Parent Product)</span>
          {option.default && <span style={{ fontSize: "0.8em", color: "#666" }}> (Default)</span>}
        </label>
        
        {hasSelection && (
          <button
            type="button"
            onClick={() => setShowVariations(!showVariations)}
            style={{
              background: "none",
              border: "1px solid #ccc",
              borderRadius: "4px",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "0.8em",
            }}
          >
            {showVariations ? "Hide" : "Show"} Variations
          </button>
        )}
      </div>

      {/* Show selected variation summary */}
      {hasSelection && selectedVariation && (
        <div style={{ marginBottom: "8px", fontSize: "0.9em", color: "#666" }}>
          Selected: {selectedVariation.name || selectedVariation.id}
          {!isFixedPrice && selectedVariation.price && ` (+${selectedVariation.price})`}
        </div>
      )}

      {/* Variation selector */}
      {showVariations && hasSelection && (
        <div style={{ marginLeft: "20px", marginTop: "8px" }}>
          <VariationSelector
            parentInfo={parentInfo}
            onSelectionChange={onSelectionChange}
            componentKey={componentKey}
            optionId={optionId}
            selectedVariationId={selectedVariationId}
            isFixedPrice={isFixedPrice}
          />
        </div>
      )}

      {/* Loading state for variations */}
      {parentInfo.loading && (
        <div style={{ marginLeft: "20px", fontSize: "0.8em", color: "#666" }}>
          Loading variations...
        </div>
      )}
    </div>
  );
});