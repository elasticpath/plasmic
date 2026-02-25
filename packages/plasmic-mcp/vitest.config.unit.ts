/**
 * Vitest config for unit tests (replaces jest.config.cjs).
 *
 * Maps @/wab/ path aliases to mock files in src/__mocks__/, exactly as
 * jest.config.cjs moduleNameMapper did. This lets unit tests use plain
 * duck-typed objects instead of real WAB model classes.
 */

import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Map @/wab/ path aliases to test mocks (same as jest moduleNameMapper)
      {
        find: /^@\/wab\/shared\/model\/classes$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-classes"),
      },
      {
        find: /^@\/wab\/shared\/model\/classes-metas$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-classes-metas"),
      },
      {
        find: /^@\/wab\/shared\/bundler$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-bundler"),
      },
      {
        find: /^@\/wab\/shared\/core\/observable-model$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-observable-model"
        ),
      },
      {
        find: /^@\/wab\/shared\/model\/InstUtil$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-inst-util"),
      },
      {
        find: /^@\/wab\/shared\/core\/tpls$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-tpls"),
      },
      {
        find: /^@\/wab\/shared\/RuleSetHelpers$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-rule-set-helpers"
        ),
      },
      {
        find: /^@\/wab\/shared\/core\/undo-util$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-undo-util"),
      },
      {
        find: /^@\/wab\/shared\/TplMgr$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-tpl-mgr"),
      },
      {
        find: /^@\/wab\/shared\/site-invariants$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-site-invariants"
        ),
      },
      {
        find: /^@\/wab\/shared\/Variants$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-variants"),
      },
    ],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  },
  test: {
    name: "unit",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/real-integration.test.ts"],
    environment: "node",
  },
});
