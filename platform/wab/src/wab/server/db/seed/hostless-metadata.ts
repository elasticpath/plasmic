/**
 * Metadata for hostless packages: dependency mapping and npm package names.
 *
 * Derived from:
 * - canvas-packages/hostlessList.json (package names)
 * - canvas-packages/esbuild.js (commerce-* → depends on "commerce")
 * - plasmicpkgs/ directory (npm package names)
 */

/** Packages that depend on the "commerce" package */
const COMMERCE_DEPENDENTS = [
  "commerce-commercetools",
  "commerce-elastic-path",
  "commerce-local",
  "commerce-saleor",
  "commerce-shopify",
  "commerce-swell",
];

/**
 * Custom npm package name overrides. Packages not listed here default to
 * `@plasmicpkgs/{name}`.
 */
const NPM_PKG_OVERRIDES: Record<string, string> = {
  // All packages default to @plasmicpkgs/{name}.
  // Add overrides here only if a package is published under a different npm scope.
};

export function getDeps(pkgName: string): string[] {
  return COMMERCE_DEPENDENTS.includes(pkgName) ? ["commerce"] : [];
}

export function getNpmPkg(pkgName: string): string {
  return NPM_PKG_OVERRIDES[pkgName] ?? `@plasmicpkgs/${pkgName}`;
}

/**
 * Returns hostless package names in dependency order:
 * 1. All non-commerce-dependent packages (including "commerce" itself)
 * 2. All commerce-dependent packages
 */
export function getOrderedPackageNames(allNames: string[]): string[] {
  const independent = allNames.filter(
    (name) => !COMMERCE_DEPENDENTS.includes(name)
  );
  const dependent = allNames.filter((name) =>
    COMMERCE_DEPENDENTS.includes(name)
  );
  return [...independent, ...dependent];
}
