import React from "react";
import { ComponentProduct } from "../types";
import { OptionProduct } from "../use-bundle-option-products";

interface OptionSelectorProps {
  option: NonNullable<ComponentProduct["options"]>[0];
  index: number;
  componentKey: string;
  selectedOptions: Record<string, number>;
  onSelectionChange: (componentKey: string, optionId: string, quantity: number) => void;
  optionProducts: Record<string, OptionProduct>;
  productsLoading: boolean;
  isFixedPrice: boolean;
  isSingleSelect: boolean;
}

export const OptionSelector = React.memo(function OptionSelector({
  option,
  index,
  componentKey,
  selectedOptions,
  onSelectionChange,
  optionProducts,
  productsLoading,
  isFixedPrice,
  isSingleSelect,
}: OptionSelectorProps) {
  const optionId = option.id || `option-${index}`;
  const currentQuantity = selectedOptions[optionId] || 0;
  const hasQuantityRange = option.min !== null || option.max !== null;
  const minQty = option.min || 1;
  const maxQty = option.max || option.quantity || 1;
  const defaultQty = option.quantity || 1;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <input
        type={isSingleSelect ? "radio" : "checkbox"}
        name={isSingleSelect ? `component-${componentKey}` : undefined}
        checked={currentQuantity > 0}
        onChange={(e) => {
          e.stopPropagation();
          if (option.id) {
            if (isSingleSelect) {
              onSelectionChange(componentKey, option.id, e.target.checked ? defaultQty : 0);
            } else {
              onSelectionChange(componentKey, option.id, e.target.checked ? minQty : 0);
            }
          }
        }}
      />
      <label style={{ flex: 1 }}>
        {(() => {
          const optionProduct = optionProducts[optionId];
          if (productsLoading) {
            return `${optionId} (Loading...)`;
          }
          if (optionProduct) {
            return (
              <span>
                {optionProduct.name || optionId}
                {!isFixedPrice && optionProduct.price && (
                  <span style={{ marginLeft: "8px", color: "#666" }}>
                    (+{optionProduct.price})
                  </span>
                )}
                {option.default && <span style={{ fontSize: "0.8em", color: "#666" }}> (Default)</span>}
              </span>
            );
          }
          return (
            <span>
              {optionId}
              {option.default && <span style={{ fontSize: "0.8em", color: "#666" }}> (Default)</span>}
            </span>
          );
        })()}
      </label>
      
      {/* Show quantity selector if option has variable quantities or max > 1 */}
      {(hasQuantityRange || maxQty > 1) && currentQuantity > 0 && (
        <input
          type="number"
          min={minQty}
          max={maxQty}
          value={currentQuantity}
          onChange={(e) => {
            e.stopPropagation();
            const value = parseInt(e.target.value) || 0;
            if (option.id && value >= minQty && value <= maxQty) {
              onSelectionChange(componentKey, option.id, value);
            }
          }}
          style={{ width: "80px" }}
        />
      )}
      
      {/* Show quantity range info */}
      {hasQuantityRange && currentQuantity > 0 && (
        <span style={{ fontSize: "0.8em", color: "#666" }}>
          ({minQty}-{maxQty})
        </span>
      )}
    </div>
  );
});