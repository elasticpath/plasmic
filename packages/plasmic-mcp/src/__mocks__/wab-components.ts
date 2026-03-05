/**
 * Mock for @/wab/shared/core/components
 *
 * Provides mockable stubs for functions used by edit-tools and package-manager:
 * - extractComponent: used by component.extract
 * - isReusableComponent: used by package-manager to filter dep components
 */

import { vi } from "vitest";

export const mockExtractComponent = vi.fn();

export function extractComponent(opts: any): any {
  return mockExtractComponent(opts);
}

export const mockIsReusableComponent = vi.fn().mockReturnValue(true);

export function isReusableComponent(component: any): boolean {
  return mockIsReusableComponent(component);
}
