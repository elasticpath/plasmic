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

### DONE (partial)

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | `screenshot.ts` exists with basic Playwright screenshot | `src/screenshot.ts` (88 lines) — `captureScreenshot()` does `page.goto(url)` + `page.screenshot()`, returns base64 PNG |
| 2 | `capture-screenshot` action in inspect tool | `server.ts:741,743` — but only supports page components with `pageMeta.path` (URL-based) |

### TODO — Major work remaining

| # | Priority | Requirement | Gap | Implementation Notes |
|---|----------|-------------|-----|---------------------|
| 1 | **P1** | `headless-renderer-entry.ts` — esbuild entry that bundles WAB rendering functions | File does not exist. Must import `renderTplNode`, `makeEmptyRenderingCtx` from WAB `canvas-rendering.ts`, `wrapWithContext` from `contexts.ts`, `deserSite` from `bundles.ts`. Exposes them on `window.__HeadlessRenderer`. | Start here — validates WAB bundling works for browser target. Most likely to surface import/compatibility issues early. Must use the same `@/` path alias resolution as the main build but target `platform: 'browser'` and `format: 'iife'`. |
| 2 | **P1** | Second esbuild entry in `build.mjs` | `build.mjs` has only one entry (`src/index.ts`). Must add a second `esbuild.build()` call: `platform: 'browser'`, `format: 'iife'`, `globalName: '__HeadlessRenderer'`, output to `dist/headless-renderer.js`. Reuse the existing `bundle-control` plugin for WAB alias resolution. | Pair with item 1 — build the entry and the esbuild config together to validate the bundle compiles. |
| 3 | **P1** | `headless-canvas.ts` (~150 lines) — Playwright orchestration with `captureWithStudioPipeline()` | File does not exist. Must: launch headless Chromium, create parent page, inject `headless-renderer.js` bundle, create iframe to dev host with `#canvas=true`, poll for `window.__Sub` (100ms intervals, 5s max), call `renderTplNode` + `setPlasmicRootNode`, screenshot the iframe. | Core orchestration file. Playwright is already a dev dependency. Dynamic import like `screenshot.ts`. |
| 4 | **P1** | Minimal ViewCtx duck-type inside `headless-canvas.ts` | Does not exist. Must provide `canvasCtx.Sub`, `site`, `viewMode()`, `focusedTpl()`, `variantTplMgr()` — enough for `renderTplNode` to work without the full Studio ViewCtx. | Part of `headless-canvas.ts`. The duck-type is a plain object, not a class. Fields can be populated from the deserialized site bundle. |
| 5 | **P1** | Update `screenshot.ts` to call `captureWithStudioPipeline` when bundle + componentName provided | Current `captureScreenshot()` only supports URL-based screenshots. Must add a second code path: if `bundle` and `componentName` are provided, delegate to `captureWithStudioPipeline()` from `headless-canvas.ts`. | Extends the existing function's signature with optional params. URL path remains the fallback. |
| 6 | **P1** | Update `server.ts` capture-screenshot handler to pass `session.bundle` and component name | Current handler only constructs a preview URL from `pageMeta.path`. Must also support non-page components by passing `session` bundle data and `component.name` to the Studio pipeline. | The handler currently has an early return if `!pageMeta?.path`. Must add an else branch for non-page components that calls the Studio pipeline. |
| 7 | **P2** | 8s timeout on iframe load / dev host unavailability | Not implemented (no iframe code exists yet). Spec requires: when dev host is not running, iframe fails to load within 8s and returns a clear error (not a hang). | Part of `headless-canvas.ts`. Use `page.waitForLoadState()` or `frame.waitForFunction()` with an 8s timeout. Return descriptive error: "Dev host not reachable at {url} — ensure it's running." |
| 8 | **P2** | Unit tests for headless canvas | `__tests__/headless-canvas.test.ts` does not exist. Must cover: iframe setup, `__Sub` polling, `renderTplNode` call, `setPlasmicRootNode` injection, timeout error path. | Mock Playwright (same pattern as `screenshot.test.ts`). Test the orchestration logic, not real browser launches. |
| 9 | **P3** | Zero modifications to upstream WAB files | Constraint — no files in `platform/wab/src/` or `packages/host/src/` should be changed. | Validate after implementation by checking `git diff` in those directories. The `headless-renderer-entry.ts` only imports from WAB, never modifies it. |

---

## Summary — Priority Order

### Fully Complete (no work remaining)
- **Spec 2: HTML Import Bridge** — all acceptance criteria met
- **Spec 3: Pattern Library** — all acceptance criteria met

### Minor Gaps (polish)
- **Spec 1: Design Guidance** — 2 items remaining:
  1. Typed `outputSchema` for `listDesignSystem` / `readComponentTree` (P3)
  2. Few-shot examples on remaining ~94 actions (P3)

### Major Work (new feature)
- **Spec 4: Headless Canvas Screenshot** — 9 items remaining:
  1. Create `headless-renderer-entry.ts` (P1)
  2. Add second esbuild entry in `build.mjs` (P1)
  3. Create `headless-canvas.ts` with `captureWithStudioPipeline` + ViewCtx duck-type (P1)
  4. Update `screenshot.ts` for Studio pipeline path (P1)
  5. Update `server.ts` capture-screenshot handler for non-page components (P1)
  6. 8s iframe timeout handling (P2)
  7. Unit tests (P2)
  8. Maintain zero upstream WAB changes (P3 — constraint)

### Recommended Implementation Order

1. **Spec 4 — Headless Canvas Screenshot** (largest gap, highest impact for visual feedback loop)
   - **Phase 1 — Bundle validation**: `headless-renderer-entry.ts` + `build.mjs` second entry. Validates that WAB rendering functions can be bundled for browser target. Most likely to surface import/compatibility issues. Run `node build.mjs` and verify `dist/headless-renderer.js` is produced.
   - **Phase 2 — Core orchestration**: `headless-canvas.ts` with Playwright iframe setup, `__Sub` polling, `renderTplNode` invocation, and ViewCtx duck-type. This is the core new functionality.
   - **Phase 3 — Wiring**: Update `screenshot.ts` to add Studio pipeline path. Update `server.ts` capture-screenshot handler to support non-page components.
   - **Phase 4 — Hardening**: 8s timeout on iframe load. Unit tests for `headless-canvas.ts`.
   - **Phase 5 — Validation**: Run full test suite. Verify zero WAB file changes. Manual smoke test with a real project.

2. **Spec 1 — Design Guidance gaps** (small polish items, can be done independently)
   - ~~**Step 1**: Migrate all 7 `server.tool()` calls to `server.registerTool()`~~ — **DONE**
   - **Step 2**: Enrich `outputSchema` on inspect — add union-typed properties with `z.optional()` for the key output shapes.
   - **Step 3**: Add few-shot examples to remaining actions. Prioritize by LLM usage frequency: `node.update-text`, `component.create-page`, `variant.create-style`, `design.create-token` first.

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
- `capture-screenshot`: Only supports page components (non-page support is Spec 4 work)

### SDK Deprecation
- ~~`server.tool()` is deprecated in `@modelcontextprotocol/sdk`~~ — **Resolved**: all 8 tools now use `server.registerTool()` with appropriate `annotations`.
