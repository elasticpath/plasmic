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
      {
        find: /^@\/wab\/shared\/core\/components$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-components"),
      },
      {
        find: /^@\/wab\/shared\/code-components\/code-components$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-code-components"
        ),
      },
      {
        find: /^@\/wab\/shared\/core\/tagged-unbundle$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-tagged-unbundle"
        ),
      },
      {
        find: /^@\/wab\/shared\/core\/project-deps$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-project-deps"
        ),
      },
      {
        find: /^@\/wab\/shared\/core\/sites$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-sites"),
      },
      // P0.0: WebSocket live sync prerequisites
      {
        find: /^@\/wab\/shared\/server-updates-utils$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-server-updates-utils"
        ),
      },
      {
        find: /^@\/wab\/commons\/asyncutil$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-asyncutil"),
      },
      {
        find: /^@\/wab\/shared\/api\/socket$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-socket-types"
        ),
      },
      {
        find: /^@\/wab\/shared\/ApiSchema$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-api-schema"),
      },
      {
        find: /^@\/wab\/shared\/Arenas$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-arenas"),
      },
      {
        find: /^@\/wab\/shared\/collections$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/wab-collections"
        ),
      },
      {
        find: /^@\/wab\/shared\/common$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-common-ext"),
      },
      {
        find: /^@\/wab\/shared\/core\/style-props$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-style-props"),
      },
      // TplQuery and its dependencies
      {
        find: /^@\/wab\/shared\/TplQuery$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-tpl-query"),
      },
      {
        find: /^@\/wab\/shared\/core\/slots$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-slots"),
      },
      {
        find: /^@\/wab\/shared\/core\/states$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-states"),
      },
      {
        find: /^@\/wab\/shared\/SlotUtils$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-slot-utils"),
      },
      {
        find: /^@\/wab\/shared\/UserError$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-user-error"),
      },
      {
        find: /^antd$/,
        replacement: path.resolve(__dirname, "src/__mocks__/wab-antd"),
      },
    ],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  },
  test: {
    name: "unit",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: [
      "src/__tests__/real-integration.test.ts",
      "src/__tests__/devhost-sync-integration.test.ts",
      "src/__tests__/package-manager.integration.test.ts",
    ],
    environment: "node",
  },
});
