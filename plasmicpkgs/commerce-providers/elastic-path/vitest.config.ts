import { defineConfig } from "vitest/config";

/**
 * Scoped vitest config — covers ONLY the better-auth-integration tests
 * under `src/auth/ep-plugin/` (per PRD #273).
 *
 * The rest of the package's ~94 test suites continue to run under jest
 * (via the workspace-root jest config). Vitest is used here because
 * better-auth and its transitive deps (`@better-auth/core`, `jose`,
 * `@noble/hashes`) ship as ESM-only with dynamic `import()` calls;
 * jest's CJS-by-default transformer cannot load them without an
 * experimental-flag rewrite that affects every other test in the
 * workspace.
 *
 * Root jest's `testPathIgnorePatterns` excludes `src/auth/ep-plugin/`
 * so the two runners don't double-up.
 */
export default defineConfig({
  test: {
    include: ["src/auth/ep-plugin/**/*.test.ts"],
    globals: false,
    environment: "node",
  },
});
