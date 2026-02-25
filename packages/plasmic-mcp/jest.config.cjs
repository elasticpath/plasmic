/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  transform: {
    "\\.tsx?$": "../../jest-transform-esbuild.js",
  },
  moduleNameMapper: {
    // Strip .js extensions from relative ESM imports for Jest CJS resolution
    "^(\\.\\.?/.*)\\.js$": "$1",
    // Map @/wab/ path aliases to test mocks
    "^@/wab/shared/model/classes$": "<rootDir>/src/__mocks__/wab-classes",
    "^@/wab/shared/model/classes-metas$":
      "<rootDir>/src/__mocks__/wab-classes-metas",
    "^@/wab/shared/bundler$": "<rootDir>/src/__mocks__/wab-bundler",
    // M2 mocks
    "^@/wab/shared/core/observable-model$":
      "<rootDir>/src/__mocks__/wab-observable-model",
    "^@/wab/shared/model/InstUtil$":
      "<rootDir>/src/__mocks__/wab-inst-util",
    "^@/wab/shared/core/tpls$": "<rootDir>/src/__mocks__/wab-tpls",
    "^@/wab/shared/RuleSetHelpers$":
      "<rootDir>/src/__mocks__/wab-rule-set-helpers",
    "^@/wab/shared/core/undo-util$":
      "<rootDir>/src/__mocks__/wab-undo-util",
    "^@/wab/shared/TplMgr$": "<rootDir>/src/__mocks__/wab-tpl-mgr",
    "^@/wab/shared/site-invariants$":
      "<rootDir>/src/__mocks__/wab-site-invariants",
  },
  testRegex: ".*\\.(spec|test)\\.(ts|tsx)$",
  // Skip vitest-based integration tests (run separately via vitest)
  testPathIgnorePatterns: ["real-integration"],
};
