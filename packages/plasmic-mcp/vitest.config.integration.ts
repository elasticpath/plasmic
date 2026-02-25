/**
 * Vitest config for real integration tests.
 *
 * Unlike the Jest unit tests (which mock all WAB modules via moduleNameMapper),
 * this config resolves @/wab/ imports to the REAL WAB source at platform/wab/src/.
 * Only two categories are stubbed:
 *   1. Browser-only packages (react, @sentry/browser, antd, etc.) — replaced
 *      with a universal Proxy stub (same pattern as build.mjs Layer 4)
 *   2. WAB client/server code (@/wab/client/*, @/wab/server/*) — not needed
 *      by the MCP server's edit/read path
 *
 * This means FastBundler.unbundle(), TplMgr, ChangeRecorder, MobX observation,
 * and all model classes run for REAL against a genuine Plasmic bundle fixture
 * (platform/wab/cypress/bundles/page-replacement.json).
 *
 * Reference: specs/plasmic-integration-tests.md
 */

import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wabSrc = path.resolve(__dirname, "../../platform/wab/src");
const stubModule = path.resolve(__dirname, "src/__mocks__/stub-module.js");
const importMobxShim = path.resolve(
  __dirname,
  "src/__mocks__/import-mobx-shim.cjs"
);

/**
 * Vite plugin: stub WAB client/server code and the import-mobx shim.
 *
 * Mirrors build.mjs Layers 1-2:
 *   - @/wab/client/* and @/wab/server/* → stub (UI/backend code)
 *   - Relative imports from wab/shared/ that escape into client/ or server/
 *   - @/wab/shared/import-mobx → shim (avoids conditional require issue)
 */
function stubWabInternals(): import("vite").Plugin {
  return {
    name: "stub-wab-internals",
    enforce: "pre",
    resolveId(id: string, importer?: string) {
      // Stub @/wab/client/* and @/wab/server/* path-aliased imports
      if (id.startsWith("@/wab/client/") || id.startsWith("@/wab/server/")) {
        return stubModule;
      }
      if (id === "@/wab/client" || id === "@/wab/server") {
        return stubModule;
      }

      // Replace import-mobx with a shim that does `module.exports = require("mobx")`
      // This avoids the conditional require("mobx/dist/mobx.cjs.development.js")
      // which Vite can't alias inside a dynamic require.
      if (
        id === "@/wab/shared/import-mobx" ||
        id.endsWith("/import-mobx") ||
        id.endsWith("/import-mobx.ts")
      ) {
        return importMobxShim;
      }

      // Stub relative imports from WAB shared/ that escape into client/ or server/
      if (importer && importer.includes("/wab/") && !id.startsWith("@/")) {
        if (
          importer.includes("/wab/shared/") ||
          importer.includes("/wab/commons/")
        ) {
          const resolvedDir = path.dirname(importer);
          const resolved = path.resolve(resolvedDir, id);
          if (
            resolved.includes("/wab/client/") ||
            resolved.includes("/wab/server/")
          ) {
            return stubModule;
          }
        }
      }

      return null;
    },
  };
}

/**
 * Vite plugin: stub browser-only npm packages.
 *
 * Mirrors build.mjs Layer 4. These packages are imported transitively by
 * WAB shared code but are never actually used by the MCP server at runtime
 * (no React rendering, no Sentry reporting, no Ant Design components).
 */
function stubBrowserPackages(): import("vite").Plugin {
  // Packages to stub — order doesn't matter (exact + prefix matching)
  const stubExact = new Set([
    "react",
    "react-dom",
    "react-aria",
    "antd",
    "html-to-react",
    "html-react-parser",
    "graphql-tag",
    "next",
    "slate",
    "slate-react",
    "is-hotkey",
  ]);

  const stubPrefixes = [
    "react/",
    "react-dom/",
    "react-aria/",
    "@sentry/",
    "@ant-design/",
    "@plasmicapp/",
    "@plasmicpkgs/",
    "@react-awesome-query-builder/",
    "@apollo/",
    "@graphiql/",
    "next/",
    "slate/",
    "slate-react/",
  ];

  return {
    name: "stub-browser-packages",
    enforce: "pre",
    resolveId(id: string) {
      if (stubExact.has(id)) {
        return stubModule;
      }
      for (const prefix of stubPrefixes) {
        if (id.startsWith(prefix)) {
          return stubModule;
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [stubWabInternals(), stubBrowserPackages()],
  resolve: {
    alias: [
      // Resolve @/ path aliases to real WAB source (same as build.mjs Layer 1)
      { find: /^@\//, replacement: path.join(wabSrc, "/") },
      // Handle malformed src/wab/ imports (tsconfig baseUrl artifact in WAB)
      { find: /^src\/wab\//, replacement: path.join(wabSrc, "wab/") },
      // Normalize MobX import path (import-mobx.ts fallback)
      {
        find: "mobx/dist/mobx.cjs.development.js",
        replacement: "mobx",
      },
    ],
  },
  test: {
    include: ["src/__tests__/real-integration.test.ts"],
    testTimeout: 30_000,
    environment: "node",
  },
});
