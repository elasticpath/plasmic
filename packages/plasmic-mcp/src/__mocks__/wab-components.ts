/**
 * Mock for @/wab/shared/core/components
 *
 * Provides mockable stubs for component-related functions used by
 * extract-component and package-manager (isReusableComponent).
 */

import { vi } from "vitest";

export const mockExtractComponent = vi.fn();
export const mockIsReusableComponent = vi.fn().mockReturnValue(true);

export function extractComponent(opts: any): any {
  return mockExtractComponent(opts);
}

export function isReusableComponent(c: any): boolean {
  return mockIsReusableComponent(c);
}

export function isCodeComponent(_c: any): boolean {
  return false;
}

export function isPageComponent(_c: any): boolean {
  return false;
}

export function allComponentVariants(_c: any): any[] {
  return [];
}
