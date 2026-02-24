import * as esbuild from "esbuild";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wabSrc = path.resolve(__dirname, "../../platform/wab/src");

/**
 * Resolve a path alias to an actual file, trying common extensions.
 */
function resolveWithExtensions(basePath) {
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".json"]) {
    const full = basePath + ext;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) return basePath;
  for (const index of ["/index.ts", "/index.tsx", "/index.js"]) {
    const full = basePath + index;
    if (fs.existsSync(full)) return full;
  }
  return basePath;
}

/**
 * Plugin: Resolve @/ path aliases and control bundle boundaries.
 *
 * What gets BUNDLED: only Plasmic shared code from platform/wab/src/wab/
 * What stays EXTERNAL: all npm packages + client/server code
 *
 * The bundle is ~1.3 MB of wab/shared code. All npm dependencies are resolved
 * from node_modules at runtime (listed in package.json dependencies).
 */
const bundlePlugin = {
  name: "bundle-control",
  setup(build) {
    // Layer 1: Handle @/ prefixed imports (platform/wab alias)
    build.onResolve({ filter: /^@\// }, (args) => {
      const subPath = args.path.slice(2);

      if (subPath.startsWith("wab/client/") || subPath.startsWith("wab/server/")) {
        return { path: args.path, external: true, sideEffects: false };
      }

      const resolved = resolveWithExtensions(path.resolve(wabSrc, subPath));
      return { path: resolved };
    });

    // Layer 2: Catch relative imports from wab/ that escape to client/ or server/
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.resolveDir?.includes("/platform/wab/src/wab/")) return;

      const resolved = path.resolve(args.resolveDir, args.path);
      if (resolved.includes("/wab/client/") || resolved.includes("/wab/server/")) {
        return { path: args.path, external: true, sideEffects: false };
      }
    });

    // Layer 3: Handle src/ prefixed imports (malformed @/ aliases in wab code).
    // Some wab code uses "src/wab/..." instead of "@/wab/..." due to tsconfig baseUrl.
    build.onResolve({ filter: /^src\/wab\// }, (args) => {
      const subPath = args.path.replace(/^src\//, "");
      if (subPath.startsWith("wab/client/") || subPath.startsWith("wab/server/")) {
        return { path: args.path, external: true, sideEffects: false };
      }
      const resolved = resolveWithExtensions(path.resolve(wabSrc, subPath));
      return { path: resolved };
    });

    // Layer 4: Stub out optional packages that wab/shared imports but the MCP
    // server doesn't need at runtime. These are packages from the Plasmic
    // monorepo that may not be built, plus their peer dependencies (React, antd).
    const stubPatterns = [
      /^@plasmicapp\//,
      /^@plasmicpkgs\//,
      /^@ant-design\//,
      /^@react-awesome-query-builder\//,
      /^antd/,
      /^react$/,
      /^react\//,
      /^react-dom/,
    ];
    const STUB_NAMESPACE = "stub-module";

    build.onResolve({ filter: /.*/ }, (args) => {
      for (const pattern of stubPatterns) {
        if (pattern.test(args.path)) {
          return { path: args.path, namespace: STUB_NAMESPACE };
        }
      }
    });

    build.onLoad({ filter: /.*/, namespace: STUB_NAMESPACE }, () => {
      return { contents: "module.exports = new Proxy({}, { get: () => () => {} });", loader: "js" };
    });

    // Layer 5: Externalize ALL bare package imports (npm packages).
    // This keeps the bundle small (~1.3 MB) and avoids CJS/ESM compatibility
    // issues with packages like css-tree that use import.meta.url.
    // All required packages must be listed in package.json dependencies.
    build.onResolve({ filter: /^[^.\/]/ }, (args) => {
      if (args.path.startsWith("@/")) return;
      if (args.path.startsWith("src/")) return; // Handled by Layer 3
      return { path: args.path, external: true };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [path.resolve(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: path.resolve(__dirname, "dist/index.cjs"),
  sourcemap: true,
  metafile: true,

  alias: {
    "mobx/dist/mobx.cjs.development.js": "mobx",
  },

  plugins: [bundlePlugin],
});

// Write metafile for bundle analysis
const metafilePath = path.resolve(__dirname, "dist/meta.json");
fs.writeFileSync(metafilePath, JSON.stringify(result.metafile, null, 2));

// Report
const outfile = path.resolve(__dirname, "dist/index.cjs");
const stats = fs.statSync(outfile);
const sizeKB = (stats.size / 1024).toFixed(1);
console.log(`✓ Built dist/index.cjs (${sizeKB} KB)`);
console.log(`  Metafile written to dist/meta.json`);

// List external requires for dependency auditing
const output = fs.readFileSync(outfile, "utf-8");
const requires = new Set(
  [...output.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]).filter(r => !r.startsWith(".") && !r.startsWith("/"))
);
console.log(`  External requires: ${requires.size} packages`);

const suspicious = ["SharedApi", "stripe", "/wab/client/", "/wab/server/"];
for (const term of suspicious) {
  if (output.includes(term)) {
    console.warn(`⚠ Warning: "${term}" found in bundle output`);
  }
}
