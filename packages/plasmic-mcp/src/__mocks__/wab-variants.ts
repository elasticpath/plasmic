/**
 * Mock for @/wab/shared/Variants
 *
 * Provides mockable implementations of variant helper functions used
 * by edit-tools.ts for variant-aware editing (P1.2).
 */

export const mockEnsureVariantSetting = jest.fn();
export const mockTryGetVariantSetting = jest.fn();

export function ensureVariantSetting(tpl: any, variants: any[]): any {
  return mockEnsureVariantSetting(tpl, variants);
}

export function tryGetVariantSetting(tpl: any, variants: any[]): any | undefined {
  return mockTryGetVariantSetting(tpl, variants);
}

export function isBaseVariant(variants: any): boolean {
  if (Array.isArray(variants)) {
    return variants.length === 1 && variants[0].name === "base";
  }
  return variants?.name === "base";
}

export function isScreenVariant(variant: any): boolean {
  return !!variant?.parent && isScreenVariantGroup(variant.parent);
}

export function isScreenVariantGroup(group: any): boolean {
  return group?.type === "global-screen";
}

export function isGlobalVariant(variant: any): boolean {
  if (!variant?.parent) return false;
  return isGlobalVariantGroup(variant.parent);
}

export function isGlobalVariantGroup(group: any): boolean {
  return group?.type !== "component";
}

export function getBaseVariant(component: any): any {
  return component?.variants?.[0];
}
