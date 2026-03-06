/**
 * Mock for @/wab/shared/Arenas
 *
 * Provides mock implementations of arena type/name helpers
 * used by the presence manager.
 */

import { vi } from "vitest";

export const getArenaType = vi.fn().mockReturnValue("component");
export const getArenaUuidOrName = vi.fn().mockReturnValue("mock-uuid");
