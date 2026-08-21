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

  // Handle variation selection change.
  //
  // onSelectionChange stays outside the state updater. React runs updaters
  // during render, so notifying from inside one made the bundle provider's
  // setValue a render-phase update on another component, and StrictMode ran
  // the whole selection twice.
  const handleVariationChange = useCallback((variationId: string, value: string) => {
    const newSelections = { ...variationSelections, [variationId]: value };
    setVariationSelections(newSelections);

    const matchingVariant = findMatchingVariant(newSelections, parentInfo);
    // No matching variant means an incomplete combination: nothing to select
    // yet, and the parent checkbox state is handled separately in the UI.
    if (!matchingVariant) return;

    if (selectedVariationId && selectedVariationId !== matchingVariant.id) {
      onSelectionChange(componentKey, optionId, 0, selectedVariationId);
    }
    onSelectionChange(componentKey, optionId, 1, matchingVariant.id);
  }, [
    variationSelections,
    parentInfo,
    onSelectionChange,
    componentKey,
    optionId,
    selectedVariationId,
  ]);

  // Calculate matching variant for current selections
  const matchingVariant = findMatchingVariant(variationSelections, parentInfo);

  return {
    variationSelections,
    setVariationSelections,
    handleVariationChange,
    matchingVariant,
  };
}