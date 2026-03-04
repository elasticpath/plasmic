/**
 * Mock for @/wab/shared/Variants
 *
 * Provides mockable implementations of variant helper functions used
 * by edit-tools.ts for variant-aware editing (P1.2).
 */

import { vi } from "vitest";

export const mockEnsureVariantSetting = vi.fn();
export const mockTryGetVariantSetting = vi.fn();

export function ensureVariantSetting(tpl: any, variants: any[]): any {
  return mockEnsureVariantSetting(tpl, variants);
}

/**
 * Mock mkVariant: creates a plain duck-typed Variant object.
 * Mirrors the real mkVariant from @/wab/shared/Variants but without
 * MobX model classes — suitable for unit tests.
 */
let _variantCounter = 0;
export function mkVariant(opts: {
  name?: string;
  codeComponentName?: string;
  codeComponentVariantKeys?: string[];
  selectors?: string[];
}): any {
  _variantCounter++;
  return {
    uuid: `mock-variant-${_variantCounter}-${Date.now()}`,
    name: opts.name ?? "",
    codeComponentName: opts.codeComponentName,
    codeComponentVariantKeys: opts.codeComponentVariantKeys,
    selectors: opts.selectors,
  };
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
