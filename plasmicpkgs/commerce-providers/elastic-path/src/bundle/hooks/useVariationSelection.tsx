import { useState, useCallback } from "react";
import { ParentProductInfo } from "../use-parent-products";
import { findMatchingVariant } from "../utils/variationMatching";

interface UseVariationSelectionProps {
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
}

interface UseVariationSelectionReturn {
  variationSelections: Record<string, string>;
  setVariationSelections: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleVariationChange: (variationId: string, value: string) => void;
  matchingVariant: ReturnType<typeof findMatchingVariant>;
}

export function useVariationSelection({
  parentInfo,
  onSelectionChange,
  componentKey,
  optionId,
  selectedVariationId,
}: UseVariationSelectionProps): UseVariationSelectionReturn {
  const [variationSelections, setVariationSelections] = useState<Record<string, string>>({});

  // Handle variation selection change
  const handleVariationChange = useCallback((variationId: string, value: string) => {
    setVariationSelections(prev => {
      const newSelections = { ...prev, [variationId]: value };
      
      // Find matching variant with updated selections
      const matchingVariant = findMatchingVariant(newSelections, parentInfo);
      
      // Update bundle selection with new variant
      if (matchingVariant) {
        // If we have a different variant selected, clear the old one first
        if (selectedVariationId && selectedVariationId !== matchingVariant.id) {
          onSelectionChange(componentKey, optionId, 0, selectedVariationId);
        }
        // Select new variant
        onSelectionChange(componentKey, optionId, 1, matchingVariant.id);
      }
      // Note: If no matching variant is found, we don't add anything to selections
      // The parent product checkbox state is handled separately in the UI
      
      return newSelections;
    });
  }, [parentInfo, onSelectionChange, componentKey, optionId, selectedVariationId]);

  // Calculate matching variant for current selections
  const matchingVariant = findMatchingVariant(variationSelections, parentInfo);

  return {
    variationSelections,
    setVariationSelections,
    handleVariationChange,
    matchingVariant,
  };
}