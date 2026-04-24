/** @type {import('jest').Config} */
module.exports = {
  modulePathIgnorePatterns: ["<rootDir>/verdaccio-storage/"],
  reporters: [
    process.env.CI ? ["github-actions", { silent: false }] : "default",
    "summary",
  ],
  testRegex:
    ".*\\/(packages|plasmicpkgs|platform)\\/.*\\.(spec|test)\\.(js|jsx|ts|tsx)$",
  testPathIgnorePatterns: [
    "<rootDir>/platform/integration-tests",
    "<rootDir>/platform/loader-tests",
    "<rootDir>/platform/wab",
    "<rootDir>/packages/plume-stories",
    "<rootDir>/packages/plasmic-mcp", // Has its own jest.config.js with @/wab/ mocks
    "<rootDir>/plasmicpkgs/wordpress", // Uses Vitest, not Jest
    "/node_modules/",
  ],
  transform: {
    "\\.tsx?$": "<rootDir>/jest-transform-esbuild.js",
  },
  // Force a single React instance across workspace packages. Some packages
  // (e.g. @plasmicapp/host) end up with their own nested `react` under
  // `packages/<pkg>/node_modules/react` when yarn 1 hoists mismatched
  // versions. That creates two React dispatchers at test time — any
  // component that crosses the package boundary (e.g. a test that renders
  // a host-provided Context.Provider) triggers a null-dispatcher throw
  // inside `useContext`. Dedupe via moduleNameMapper so every import of
  // `react` / `react-dom` resolves to the root copy.
  moduleNameMapper: {
    "^react$": "<rootDir>/node_modules/react",
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    "^react/(.*)$": "<rootDir>/node_modules/react/$1",
    "^react-dom/(.*)$": "<rootDir>/node_modules/react-dom/$1",
  },
};
