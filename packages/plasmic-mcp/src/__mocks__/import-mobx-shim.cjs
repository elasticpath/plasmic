/**
 * Shim for @/wab/shared/import-mobx.
 *
 * The real import-mobx.ts does a conditional require:
 *   typeof window === "undefined"
 *     ? require("mobx/dist/mobx.cjs.development.js")
 *     : require("mobx")
 *
 * This conditional require is hard for Vite to alias because it's
 * dynamically evaluated. This shim replaces the entire module with
 * a simple re-export of the standard mobx package entry point.
 */
module.exports = require("mobx");
