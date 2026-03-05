# Implementation Plan

Status report for the 4 specs in `.ralph/specs/` against the current codebase on
`feat/mcp-design-enhancements`. Last verified: 2026-03-05.

---

## Spec 1: Design Guidance (`design-guidance.md`)

### DONE

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | `inspect` registered via `registerTool` with `annotations: { readOnlyHint: true }` | `server.ts:726-758` |
| 2 | `listDesignSystem` action exists (`list-design-system`) | `server.ts:743` action enum, description at line 739 |
| 3 | `readComponentTree` produces `layoutHint` field per node | `tree-reader.ts` — `deriveLayoutHint()` populates `layoutHint` on TplTag and TplComponent nodes |
| 4 | `outputSchema` on inspect tool | `server.ts:753` — permissive `{}` schema (intentional: tool returns different shapes per action) |
| 5 | "Design System First" advisory in `design` tool description | `server.ts:3638+` — full advisory text present with "Raw CSS values are always valid — tokens are preferred, not required." |
| 6 | "Layout Guidance" in `node` tool description | `server.ts:2364` — "Layout guidance: use flexDirection:column for vertical stacks..." present |
| 7 | Few-shot examples in `inspect` tool description | `server.ts:731,739,740,741` — tree, list-design-system, list-patterns, capture-screenshot all have `Example:` with input→output |
| 8 | Few-shot examples in `node` tool description | `server.ts:2353-2354` — add and update-styles have examples; `server.ts:2362-2363` — import-html and apply-pattern have examples |
| 9 | Few-shot examples in `design` tool description | `server.ts:3646` — list-tokens example present |
| 10 | All 8 tools migrated from deprecated `server.tool()` to `server.registerTool()` with annotations | `project`: `idempotentHint: true`; `component`, `node`, `variant`, `design`, `data`, `interaction`: `destructiveHint: true`; `inspect`: `readOnlyHint: true` (was already migrated) |

### TODO

| # | Priority | Requirement | Gap | Implementation Notes |
|---|----------|-------------|-----|---------------------|
| 1 | **P3** | Per-action `outputSchema` for `listDesignSystem` and `readComponentTree` | Current `outputSchema` is `{}` for the entire inspect tool. Spec calls for typed schemas matching return shapes. Blocked by single-tool-multi-action architecture — one `outputSchema` covers all actions. | Recommend: add JSON Schema properties describing the union shape with `additionalProperties: true`. E.g. `tokens: z.record(z.array(...)).optional()`, `tree: z.object({...}).optional()`. This preserves the permissive pass-through while giving clients typed hints for the two most important actions. |
| 2 | **P3** | Few-shot examples on ALL actions | ~10 of ~104 actions have examples. Missing: `inspect.summary/node/subtree/export/style-properties/preview-url/page-meta`; `node.update-text/move/clone/reorder/update-attrs/update-props/set-visibility/set-image/apply-mixin/detach-mixin/add-animation/remove-animation/update-rich-text`; `design.create-token/update-token/remove-token/duplicate-token/create-mixin/update-mixin/remove-mixin/create-animation/update-animation/remove-animation/create-theme/update-theme/remove-theme/set-active-theme/upload-asset/rename-asset/remove-asset`; `component.*` (18 actions); `variant.*` (12 actions); `data.*` (16 actions); `interaction.*` (4 actions). | Add examples incrementally, grouped by tool. Each example is 1 line in the tool description string. Prioritize actions most commonly used by LLMs: `node.update-text`, `node.update-styles`, `node.update-attrs`, `component.create-page`, `variant.create-style`, `design.create-token`. |

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
| 6 | Handles WIContainer, WIText, WISVG, WIComponent | Implemented. SVG stored as `dangerouslySetInnerHTML` (v1 limitation, documented). |
| 7 | Style variant handling (pseudo-classes, screen variants) | Pseudo-classes: creates style variants then applies styles. `@media` breakpoints: generates warning and skips (explicit v1 limitation — screen variants must be matched manually). |
| 8 | `jsdom` in package.json dependencies | Present in `dependencies` |
| 9 | Unit tests | `__tests__/html-importer.test.ts` — covers element kinds, CSS extraction, pseudo/media styles, attribute collection, SVG handling, cache invalidation |
| 10 | No changes to existing MCP tool schemas | Confirmed |

### TODO

None — this spec is fully implemented.

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

### TODO

None — this spec is fully implemented.

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

### TODO

None — this spec is fully implemented.

---

## Summary

### Fully Complete (no work remaining)
- **Spec 2: HTML Import Bridge** — all acceptance criteria met
- **Spec 3: Pattern Library** — all acceptance criteria met
- **Spec 4: Headless Canvas Screenshot** — all acceptance criteria met

### Minor Gaps (polish only)
- **Spec 1: Design Guidance** — 2 items, both P3:
  1. Typed `outputSchema` for `listDesignSystem` / `readComponentTree` — current schema is permissive `{}`. Add union-typed properties with `z.optional()` for the two most important output shapes.
  2. Few-shot examples on remaining ~94 actions — prioritize `node.update-text`, `component.create-page`, `variant.create-style`, `design.create-token`.

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
