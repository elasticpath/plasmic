/**
 * Mock for @/wab/shared/core/sites
 *
 * Provides mockable stubs for site utility functions used by
 * package-manager.ts. isHostLessPackage determines if a dependency
 * is a hostless (code component) package. getNonTransitiveDepDefaultComponents
 * gets default components owned by a dependency's site.
 */

import { vi } from "vitest";

export const mockIsHostLessPackage = vi.fn(() => true);
export const mockGetNonTransitiveDepDefaultComponents = vi.fn(() => ({}));

export const isHostLessPackage = (...args: any[]) =>
  mockIsHostLessPackage(...args);
export const getNonTransitiveDepDefaultComponents = (...args: any[]) =>
  mockGetNonTransitiveDepDefaultComponents(...args);
