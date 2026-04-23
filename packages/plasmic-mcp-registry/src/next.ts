/**
 * Next.js config wrapper that auto-detects Plasmic packages and adds them
 * to serverExternalPackages to prevent RSC boundary errors.
 *
 * Why: Next.js App Router's static analysis triggers RSC boundary errors
 * when server-side API routes import component registration modules that
 * transitively import React hooks — even though those hooks are never
 * called server-side.
 *
 * This wrapper uses TWO mechanisms:
 * 1. serverExternalPackages — works for packages resolved from node_modules
 * 2. webpack externals — works for monorepo/workspace packages resolved
 *    via local file paths (where serverExternalPackages has no effect,
 *    see https://github.com/vercel/next.js/issues/48739)
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
  webpack?: (config: WebpackConfig, context: WebpackContext) => WebpackConfig;
  [key: string]: unknown;
}

interface WebpackConfig {
  externals?: unknown[];
  [key: string]: unknown;
}

interface WebpackContext {
  isServer: boolean;
  [key: string]: unknown;
}

/**
 * Package patterns for `serverExternalPackages`.
 *
 * Empty by default — with the `eval("require")` handling in capture.ts
 * for `@plasmicapp/host`, there's no remaining reason to externalise
 * Plasmic-related packages at the Next config level. Externalisation
 * forces Node to load modules with a separate React instance, which
 * breaks SSR of client components whose hooks then hit a null
 * dispatcher. Empty patterns let webpack bundle everything into Next's
 * graph where `"use client"` directives correctly trigger client-boundary
 * handling and one React instance runs end-to-end.
 *
 * A consumer who hits a genuine RSC failure from some other package can
 * still externalise it by passing `serverExternalPackages: ["…"]` in
 * their own config; this wrapper merges the lists.
 */
const PLASMIC_PACKAGE_PATTERNS: RegExp[] = [];

/** Webpack externals mirror the same set. Empty — see comment block above. */
const WEBPACK_EXTERNAL_PATTERNS: RegExp[] = [];

/**
 * Auto-detects Plasmic-related packages from the consumer's package.json
 * and adds them to the Next.js config's serverExternalPackages. Also adds
 * a webpack externals function for monorepo packages that resolve to local
 * paths instead of node_modules.
 *
 * @param config - The consumer's Next.js config (may be empty)
 * @returns The config with serverExternalPackages and webpack externals populated
 */
export function withPlasmicRegistry(config: NextConfig = {}): NextConfig {
  const detected = detectPlasmicPackages();
  const existing = config.serverExternalPackages ?? [];

  // Merge and deduplicate
  const merged = [...new Set([...existing, ...detected])];

  const userWebpack = config.webpack;

  return {
    ...config,
    serverExternalPackages: merged,
    webpack(webpackConfig: WebpackConfig, context: WebpackContext) {
      // Only modify server-side builds — client bundles need the full modules
      if (context.isServer) {
        const externals = webpackConfig.externals ?? [];

        // Add a function that externalizes Plasmic packages by import specifier.
        // This catches monorepo packages that yarn/npm resolves via symlinks or
        // local paths, which serverExternalPackages misses.
        (externals as unknown[]).push(
          (
            { request }: { request?: string },
            callback: (err?: Error | null, result?: string) => void
          ) => {
            if (
              request &&
              WEBPACK_EXTERNAL_PATTERNS.some((p) => p.test(request))
            ) {
              // Externalize: tell webpack to require() this at runtime
              // instead of bundling it (skips RSC static analysis)
              return callback(null, `commonjs ${request}`);
            }
            return callback();
          }
        );

        webpackConfig.externals = externals;
      }

      // Chain with user's existing webpack config if present
      if (userWebpack) {
        return userWebpack(webpackConfig, context);
      }
      return webpackConfig;
    },
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
