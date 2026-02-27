/**
 * Next.js config wrapper that auto-detects Plasmic packages and adds them
 * to serverExternalPackages to prevent RSC boundary errors.
 *
 * Why: Next.js App Router's static analysis triggers RSC boundary errors
 * when server-side API routes import component registration modules that
 * transitively import React hooks — even though those hooks are never
 * called server-side. Adding packages to serverExternalPackages tells
 * Next.js to skip RSC bundler analysis for those packages.
 *
 * Usage:
 *   const { withPlasmicRegistry } = require("@elasticpath/plasmic-mcp-registry/next");
 *   module.exports = withPlasmicRegistry({ reactStrictMode: true });
 *
 * Zero Next.js npm dependency — uses only Node.js built-ins (fs, path).
 */

import * as fs from "fs";
import * as path from "path";

/** Minimal NextConfig shape — only the fields we read/write. */
interface NextConfig {
  serverExternalPackages?: string[];
  [key: string]: unknown;
}

/** Package prefixes that should be externalized for RSC safety. */
const PLASMIC_PACKAGE_PATTERNS = [
  /^@plasmicpkgs\//,
  /^@elasticpath\/plasmic-/,
  /^@plasmicapp\/host$/,
];

/**
 * Auto-detects Plasmic-related packages from the consumer's package.json
 * and adds them to the Next.js config's serverExternalPackages.
 *
 * @param config - The consumer's Next.js config (may be empty)
 * @returns The config with serverExternalPackages populated
 */
export function withPlasmicRegistry(config: NextConfig = {}): NextConfig {
  const detected = detectPlasmicPackages();
  const existing = config.serverExternalPackages ?? [];

  // Merge and deduplicate
  const merged = [...new Set([...existing, ...detected])];

  return {
    ...config,
    serverExternalPackages: merged,
  };
}

/**
 * Reads the consumer's package.json and extracts Plasmic-related package names.
 */
function detectPlasmicPackages(): string[] {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);

    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    return Object.keys(allDeps).filter((name) =>
      PLASMIC_PACKAGE_PATTERNS.some((pattern) => pattern.test(name))
    );
  } catch {
    console.warn(
      "[@elasticpath/plasmic-mcp-registry] Could not read package.json — " +
        "serverExternalPackages will not be auto-populated."
    );
    return [];
  }
}
