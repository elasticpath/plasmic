/**
 * Mock for @/wab/shared/core/components
 *
 * Provides a mockable stub for extractComponent() which is used by
 * the component.extract action to extract a subtree into a new component.
 */

import { vi } from "vitest";

export const mockExtractComponent = vi.fn();

export function extractComponent(opts: any): any {
  return mockExtractComponent(opts);
}
