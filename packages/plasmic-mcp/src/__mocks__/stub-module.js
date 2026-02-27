/**
 * Universal proxy stub for browser-only packages that WAB shared code
 * transitively imports but the MCP server doesn't need at runtime.
 *
 * Returns a Proxy that satisfies any access pattern:
 *   - Default import: `import X from "pkg"` → X is the proxy
 *   - Named import:  `import { Y } from "pkg"` → Y is the proxy (via CJS interop)
 *   - Namespace:     `import * as Z from "pkg"` → Z.any is the proxy
 *   - Constructor:   `new X()` → the proxy
 *   - Function call: `X()` → the proxy
 *
 * Same pattern as build.mjs Layer 4, adapted for Vitest module resolution.
 *
 * Why this works: Vite's CJS-to-ESM interop accesses properties on
 * `module.exports` to extract named exports. The Proxy's `get` trap
 * returns `proxy` for every property, so all named imports resolve to
 * a callable, constructable proxy — no "is not a function" errors.
 */
const handler = {
  get(_, prop) {
    if (typeof prop === "symbol") return undefined;
    return proxy;
  },
  apply() {
    return proxy;
  },
  construct() {
    return proxy;
  },
};

const proxy = new Proxy(function () {}, handler);

module.exports = proxy;
