/**
 * The server's own version, injected at build time by esbuild's `define` from
 * package.json (see build.mjs). Falls back to "dev" when run through tsx.
 *
 * Everything that reports a version must read it from here. Hardcoded values
 * drift silently and leave no way to tell which build is installed.
 */

declare const __MCP_VERSION__: string;

export const VERSION =
  typeof __MCP_VERSION__ !== "undefined" ? __MCP_VERSION__ : "dev";
