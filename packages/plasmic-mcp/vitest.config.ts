/**
 * Root Vitest config — replaces deprecated vitest.workspace.ts.
 *
 * Uses `test.projects` to reference the unit and integration configs.
 * See: vitest.config.unit.ts (mocked WAB) and vitest.config.integration.ts (real WAB).
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["vitest.config.unit.ts", "vitest.config.integration.ts"],
  },
});
