/**
 * Mock for @/wab/shared/site-invariants
 *
 * The real assertSiteInvariants validates model consistency before saving.
 * In tests we skip validation since we're using mock model objects.
 */

import { vi } from "vitest";

export const mockAssertSiteInvariants = vi.fn();

export function assertSiteInvariants(_site: any): void {
  mockAssertSiteInvariants(_site);
}
