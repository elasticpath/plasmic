/**
 * Mock for @/wab/shared/core/project-deps
 *
 * Provides mockable stubs for dependency management functions used by
 * package-manager.ts. These functions handle transitive dependency extraction,
 * global context synchronization, and dependency upgrades.
 */

import { vi } from "vitest";

export const mockExtractTransitiveDepsFromComponentDefaultSlots = vi.fn(
  () => []
);
export const mockExtractTransitiveHostLessPackages = vi.fn(() => []);
export const mockSyncGlobalContexts = vi.fn();
export const mockUpgradeProjectDeps = vi.fn();

export const extractTransitiveDepsFromComponentDefaultSlots = (...args: any[]) =>
  mockExtractTransitiveDepsFromComponentDefaultSlots(...args);
export const extractTransitiveHostLessPackages = (...args: any[]) =>
  mockExtractTransitiveHostLessPackages(...args);
export const syncGlobalContexts = (...args: any[]) =>
  mockSyncGlobalContexts(...args);
export const upgradeProjectDeps = (...args: any[]) =>
  mockUpgradeProjectDeps(...args);

// Used by preview-server.ts codegen
export function walkDependencyTree() { return []; }
