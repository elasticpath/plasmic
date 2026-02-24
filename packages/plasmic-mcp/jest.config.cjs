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
  },
  testRegex: ".*\\.(spec|test)\\.(ts|tsx)$",
};
