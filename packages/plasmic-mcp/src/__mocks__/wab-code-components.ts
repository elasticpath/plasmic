/**
 * Mock for @/wab/shared/code-components/code-components
 */

import { vi } from "vitest";

export const mockElementSchemaToTpl = vi.fn();

export function elementSchemaToTpl(...args: any[]): any {
  return mockElementSchemaToTpl(...args);
}
