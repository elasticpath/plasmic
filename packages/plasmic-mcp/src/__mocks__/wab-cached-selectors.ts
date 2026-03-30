/**
 * Mock for @/wab/shared/cached-selectors
 */
import { vi } from "vitest";

export const componentToTplComponents = vi.fn().mockReturnValue(new Map());
export const componentsReferencingDataToken = vi.fn().mockReturnValue(new Set());
export const deepComponentToReferencers = vi.fn().mockReturnValue(new Map());
export const extractComponentVariantSettings = vi.fn().mockReturnValue(new Map());
export const extractImageAssetRefsByAttrs = vi.fn().mockReturnValue(new Set());
export const getActiveVariantsForFrame = vi.fn().mockReturnValue([]);
