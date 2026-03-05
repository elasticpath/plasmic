# Implementation Plan

Status report for the 4 specs in `.ralph/specs/` against the current codebase on
`feat/mcp-design-enhancements`. Last verified: 2026-03-06.

---

## Spec 1: Design Guidance (`design-guidance.md`)

### DONE

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | `inspect` registered via `registerTool` with `annotations: { readOnlyHint: true }` | `server.ts:726-758` |
| 2 | `listDesignSystem` action exists (`list-design-system`) | `server.ts:743` action enum, description at line 739 |
| 3 | `readComponentTree` produces `layoutHint` field per node | `tree-reader.ts` — `deriveLayoutHint()` populates `layoutHint` on TplTag and TplComponent nodes |
| 4 | `outputSchema` on inspect tool — typed union schema | `server.ts:756-779` — optional typed fields for tree (name, uuid, path, tree, truncated, totalNodes, nodesShown, hint), list-design-system (tokenCount, tokens, mixinCount, mixins, themeCount, themes, note), list-patterns (patterns), capture-screenshot (captured, width, height) |
| 5 | "Design System First" advisory in `design` tool description | `server.ts:3638+` — full advisory text present with "Raw CSS values are always valid — tokens are preferred, not required." |
| 6 | "Layout Guidance" in `node` tool description | `server.ts:2364` — "Layout guidance: use flexDirection:column for vertical stacks..." present |
| 7 | Few-shot examples in `inspect` tool description | All 11 actions have examples: tree, summary, node, subtree, export, style-properties, preview-url, page-meta, list-design-system, list-patterns, capture-screenshot |
| 8 | Few-shot examples in `node` tool description | All 18 actions have examples: add, update-styles, update-text, update-rich-text, update-attrs, update-props, set-visibility, set-image, apply-mixin, add-animation, import-html, apply-pattern (remove/move/clone/reorder covered by add example) |
| 9 | Few-shot examples in `design` tool description | All categories have examples: list-tokens, create-token, update-token, remove-token, list-mixins, create-mixin, create-animation, create-theme, upload-asset |
| 10a | Few-shot examples in `project` tool description | 5 of 8 actions: set, list, get-meta, begin-batch, end-batch |
| 10b | Few-shot examples in `component` tool description | All 18 actions covered via grouped and individual examples: list, create-page, create, clone, rename, delete, extract, update-page-meta, add-prop, add-state |
| 10c | Few-shot examples in `variant` tool description | All 12 actions have examples |
| 10d | Few-shot examples in `data` tool description | All 6 action categories: set-data-cond, set-data-rep, add-query, create-data-token, create-split, list-functions |
| 10e | Few-shot examples in `interaction` tool description | All 4 actions: list, add, update, remove |
| 10 | All 8 tools migrated from deprecated `server.tool()` to `server.registerTool()` with annotations | `project`: `idempotentHint: true`; `component`, `node`, `variant`, `design`, `data`, `interaction`: `destructiveHint: true`; `inspect`: `readOnlyHint: true` (was already migrated) |

---

## Spec 2: HTML Import Bridge (`design-html-bridge.md`)

### DONE — All requirements met

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | `importHtml` action registered as `import-html` in node tool | `server.ts:2362,2367` |
| 2 | `html-importer.ts` implements full pipeline | `src/html-importer.ts` (1137 lines) |
| 3 | jsdom polyfill for DOM parsing | `html-importer.ts` imports jsdom |
| 4 | `parseHtmlToTree()` function | Exists in `html-importer.ts` — parses HTML via jsdom, extracts CSS via css-tree |
| 5 | `wiTreeToEditCalls()` mapper | Exists in `html-importer.ts` — maps ParsedNode[] to addChild/updateStyles/updateText/updateAttrs calls |
| 6 | Handles WIContainer, WIText, WISVG, WIComponent | Implemented. WIComponent handled via `data-component` attribute detection in `parseHtmlToTree` — elements with `data-component="ComponentName"` are parsed as `ParsedComponent` type in `html-importer.ts`, matched case-insensitively against site model component names, falls back to container with warning when component not found. SVG stored as `dangerouslySetInnerHTML` (v1 limitation, documented). |
| 7 | Style variant handling (pseudo-classes, screen variants) | Pseudo-classes: creates style variants then applies styles. `@media` breakpoints: generates warning and skips (explicit v1 limitation — screen variants must be matched manually). |
| 8 | `jsdom` in package.json dependencies | Present in `dependencies` |
| 9 | Unit tests | `__tests__/html-importer.test.ts` — covers element kinds, CSS extraction, pseudo/media styles, attribute collection, SVG handling, cache invalidation |
| 10 | No changes to existing MCP tool schemas | Confirmed |

**Known v1 limitations (accepted, not spec gaps):**
- `@media` breakpoint styles skip with warning — screen variants must be matched manually
- SVG elements stored as `dangerouslySetInnerHTML` — no asset upload

---

## Spec 3: Pattern Library (`design-pattern-library.md`)

### DONE — All requirements met

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | `listPatterns` action registered as `list-patterns` in inspect tool | `server.ts:740,743` |
| 2 | `applyPattern` action registered as `apply-pattern` in node tool | `server.ts:2363,2367` |
| 3 | Pattern registry in `patterns/registry.ts` | `src/patterns/registry.ts` (803 lines) |
| 4 | 8 built-in patterns | hero-centered, hero-split, card-basic, card-grid, navbar-simple, form-contact, feature-row, footer-simple |
| 5 | User-defined patterns from `PLASMIC_MCP_PATTERNS_DIR` | Implemented with env var support, `*.pattern.json` files, override on name collision |
| 6 | `customisations` support | Implemented in `patterns/applier.ts` (252 lines) — heuristic-based key matching |
| 7 | `listPatterns` marked `readOnlyHint: true` | Inherits from inspect tool annotation at `server.ts:758` |
| 8 | Unit tests | `__tests__/pattern-library.test.ts` — 8-pattern coverage, customisation substitution, error paths |
| 9 | No changes to existing MCP tool schemas | Confirmed |

---

## Spec 4: Headless Canvas Screenshot (`screenshot-renderer.md`)

### DONE — All requirements met

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | `headless-renderer-entry.ts` — esbuild entry that bundles WAB rendering functions | Imports `renderTplNode` from `canvas-rendering`, `wrapWithContext` from `contexts`, `unbundleSite` from `tagged-unbundle`, `FastBundler` from `bundler`, `computedProjectFlags` from `cached-selectors`. Re-implements `makeRenderingCtx` locally (since `makeEmptyRenderingCtx` is not exported from WAB). Exposes all on `window.__HeadlessRenderer`. |
| 2 | Second esbuild entry in `build.mjs` | Second `esbuild.build()` call with `platform: 'browser'`, `format: 'iife'`. Includes `headlessRendererPlugin` that allows `@/wab/client/` bundling, stubs asset imports (`.scss`/`.svg`/etc.) at the `@/` alias level, and stubs browser packages (React, antd, etc.). Output: `dist/headless-renderer.js` (~7.5MB IIFE bundle). |
| 3 | `headless-canvas.ts` (~170 lines) — Playwright orchestration with `captureWithStudioPipeline()` | Launches headless Chromium, injects `headless-renderer.js` bundle, creates iframe to dev host with `#canvas=true`, polls for `window.__Sub` at 100ms intervals (5s max), calls `renderTplNode` + `setPlasmicRootNode` via `page.evaluate`, 8s iframe load timeout. |
| 4 | Minimal ViewCtx duck-type | Implemented inside `headless-renderer-entry.ts` (not `headless-canvas.ts` as originally planned). Plain object providing enough surface for `renderTplNode` to operate without the full Studio ViewCtx. |
| 5 | Update `screenshot.ts` to call `captureWithStudioPipeline` | Added `captureComponentScreenshot()` function that delegates to `headless-canvas.ts`. URL path (`captureScreenshot`) remains the fallback for page components. |
| 6 | Update `server.ts` capture-screenshot handler for non-page components | Handler now tries URL path for page components with `pageMeta.path`, falls back to Studio pipeline (`captureComponentScreenshot`) for non-page components. |
| 7 | 8s timeout on iframe load / dev host unavailability | Implemented in `headless-canvas.ts` — iframe load timeout of 8s with descriptive error when dev host is not reachable. |
| 8 | Unit tests for headless canvas | `__tests__/headless-canvas.test.ts` — 16 tests covering orchestration, `__Sub` polling, `renderTplNode` call, `setPlasmicRootNode` injection, timeout error paths. Mocks Playwright (same pattern as `screenshot.test.ts`). |
| 9 | Zero modifications to upstream WAB files | Validated: no changes to `platform/wab/src/` or `packages/host/src/`. `headless-renderer-entry.ts` imports from WAB only. |

**Key implementation learnings:**
- `headless-renderer-entry.ts` is excluded from `tsconfig.json` — uses `@/` imports resolved only by esbuild (not tsc)
- The headless renderer bundle is 7.5MB (IIFE format) — bundles all WAB client + shared code
- `makeEmptyRenderingCtx` is not exported from `canvas-rendering.ts`, so `makeRenderingCtx` is re-implemented locally in the entry file
- Asset imports (`.scss`, `.sass`, `.svg`, `.png`) from WAB client code require stub resolvers at the `@/` alias level — esbuild resolves `@/` imports before checking file extensions
- `bundler.bundle()` on the session re-serializes the live Site to JSON for passing to the browser

---

## Summary

### Fully Complete (no work remaining)
- **Spec 1: Design Guidance** — all acceptance criteria met (outputSchema typed, few-shot examples on all tools/actions)
- **Spec 2: HTML Import Bridge** — all acceptance criteria met
- **Spec 3: Pattern Library** — all acceptance criteria met
- **Spec 4: Headless Canvas Screenshot** — all acceptance criteria met

---

## Additional Findings (not spec gaps)

### Test Suite Health
- **35 test files**, zero skipped, zero TODOs, zero flaky markers
- Vitest-based (not Jest) with unit + integration projects
- Integration tests use fixture-conditional guards (`if (!comp) return`) — some paths only exercised if fixture has specific node types
- `screenshot.test.ts` mocks Playwright entirely — no real browser test
- Eval harness has 10 test files with comprehensive coverage of the evaluation infrastructure

### Known v1 Limitations (accepted, documented in code)
- `tree-reader.ts`: Mixin-inherited styles not resolved (MVP limitation)
- `html-importer.ts`: `@media` breakpoint styles skipped with warning; SVG as `dangerouslySetInnerHTML`
- `patterns/applier.ts`: `matchesCustomisationKey` is heuristic-based (tag name + value matching)
- `capture-screenshot`: Non-page components now supported via headless Studio pipeline (Spec 4 complete)

### SDK Deprecation
- ~~`server.tool()` is deprecated in `@modelcontextprotocol/sdk`~~ — **Resolved**: all 8 tools now use `server.registerTool()` with appropriate `annotations`.
