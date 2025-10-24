import React from "react";
import { ParentProductInfo } from "../use-parent-products";
import { useVariationSelection } from "../hooks/useVariationSelection";

interface VariationSelectorProps {
  parentInfo: ParentProductInfo;
  onSelectionChange: (
    componentKey: string, 
    optionId: string, 
    quantity: number, 
    variationId?: string
  ) => void;
  componentKey: string;
  optionId: string;
  selectedVariationId?: string;
  isFixedPrice: boolean;
}

export function VariationSelector({
  parentInfo,
  onSelectionChange,
  componentKey,
  optionId,
  selectedVariationId,
  isFixedPrice,
}: VariationSelectorProps) {
  const {
    variationSelections,
    handleVariationChange,
    matchingVariant,
  } = useVariationSelection({
    parentInfo,
    onSelectionChange,
    componentKey,
    optionId,
    selectedVariationId,
  });

  const variations = parentInfo.variations || [];

  if (!variations || variations.length === 0) {
    return (
      <div style={{ fontSize: "0.9em", color: "#666" }}>
        No variations available. This parent product may need to be configured differently.
      </div>
    );
  }

  return (
    <>
      <div style={{ fontSize: "0.9em", fontWeight: "bold", marginBottom: "6px" }}>
        Choose Variation:
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {variations.map((variation) => (
          <div key={variation.id} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "0.8em", fontWeight: "bold" }}>
              {variation.name}:
            </label>
            <select
              value={variationSelections[variation.id] || ""}
              onChange={(e) => {
                e.stopPropagation();
                handleVariationChange(variation.id, e.target.value);
              }}
              style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: "4px" }}
            >
              <option value="">Select {variation.name}</option>
              {variation.options?.map((option) => (
                <option key={option.id} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      
      {/* Show selected variant info */}
      {Object.keys(variationSelections).length === variations.length && (
        <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#f0f8ff", borderRadius: "4px" }}>
          {matchingVariant ? (
            <div style={{ fontSize: "0.8em", color: "#333" }}>
              <div><strong>Selected Variant:</strong> {matchingVariant.name || matchingVariant.id}</div>
              {matchingVariant.sku && <div><strong>SKU:</strong> {matchingVariant.sku}</div>}
              {!isFixedPrice && matchingVariant.price && (
                <div><strong>Price:</strong> +{matchingVariant.price}</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: "0.8em", color: "#d32f2f" }}>
              No matching variant found for this combination.
            </div>
          )}
        </div>
      )}
      
      {/* Show excluded variations separately for transparency */}
      {parentInfo.children?.some(child => child.excluded) && (
        <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <div style={{ fontSize: "0.8em", color: "#666", marginBottom: "4px" }}>
            Excluded variations (not available in this bundle):
          </div>
          {parentInfo.children
            .filter(child => child.excluded)
            .map((child) => (
              <div key={child.id} style={{ fontSize: "0.8em", color: "#999", marginLeft: "10px" }}>
                • {child.name || child.id}
                {child.sku && ` (${child.sku})`}
              </div>
            ))}
        </div>
      )}
    </>
  );
}