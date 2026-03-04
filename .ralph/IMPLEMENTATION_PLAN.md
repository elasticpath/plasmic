# Implementation Plan

## Summary

Four specs in `.ralph/specs/` describe MCP design enhancements. **None have any
implementation yet.** The existing `packages/plasmic-mcp/` codebase is mature
(103 actions across 8 tools, comprehensive test suite, no TODOs/placeholders,
no skipped tests). The WAB-side infrastructure the specs depend on is fully
implemented. The MCP SDK v1.27.1 supports both `ToolAnnotations` and
`outputSchema` — no upgrade needed.

**Verified 2026-03-04:** Every item below is confirmed unimplemented via code search.
Zero TODOs, zero FIXME/HACK, zero skipped tests, zero placeholders in `packages/plasmic-mcp/src/`.
The 5 runtime conditional skips in `real-integration.test.ts` are fixture-aware guards, not incomplete work.

---

## Priority 1 — Design Guidance (Low effort, high impact)

**Spec:** `design-guidance.md`

Pure description/annotation improvements — no new infrastructure, highest
ROI for LLM output quality. All items are independent of each other.

- [x] **P1.1 — `listDesignSystem` inspect action**
  - New action on `inspect` tool in `server.ts` (add to action enum at line ~612)
  - Calls `readTokens(getAllStyleTokens(site))` from `token-reader.ts` — returns
    `{ tokenCount, tokens: Record<string, TokenInfo[]> }` already grouped by type
  - No new data formatting needed — `readTokens()` output is already LLM-friendly
  - When no tokens exist, return empty list with advisory note (per memory: no
    imposed default system)
  - **Note:** `design` tool already has a `list-tokens` action (server.ts line ~3387)
    that calls `readTokens()` with optional `tokenType` filter. The new `listDesignSystem`
    on `inspect` is a consolidated single-call summary (tokens + mixins + themes) for
    the LLM to orient before making design changes — different intent from the
    per-type `list-tokens` action.
  - **Implementation note:** Uses `getAllStyleTokens()` (includes dependency tokens)
    rather than `site.styleTokens` directly. Returns consolidated tokens + mixins +
    themes. Includes advisory note when design system is empty.
  - Unit tests: verify output shape, verify empty-tokens case

- [x] **P1.2 — `layoutHint` field on `readComponentTree` output**
  - **Decision:** Add `layoutHint` as new field alongside existing `layoutType`
    (backwards-compatible, no breaking change)
  - Add `deriveLayoutHint()` in `tree-reader.ts` that maps:
    - `display: grid` or `display: inline-grid` → `"grid"` (currently undetected — falls to `"box"`)
    - `flexDirection: column|column-reverse` → `"flex-col"` (currently `"vbox"`)
    - `flexDirection: row|row-reverse` or bare `display: flex` → `"flex-row"` (currently `"hbox"`)
    - Everything else → `"block"` (currently `"box"`)
  - Add `layoutHint?: "flex-row" | "flex-col" | "grid" | "block"` to `TreeNode` in `types.ts` (line ~231)
  - Call `deriveLayoutHint()` alongside existing `deriveLayoutType()` in `readTplTag()` (line ~440) and `readTplComponent()` (line ~587)
  - Consider adding to summary mode too (currently skipped when `summaryOnly`)
  - Update inspect tests

- [x] **P1.3 — Tool annotations (`readOnlyHint`, `destructiveHint`)**
  - **SDK verified:** `ToolAnnotations` (plural) supported in SDK 1.27.1 via
    `server.tool(name, description, schema, annotations, handler)` overload
  - Add annotations to all 8 tool registrations:
    - `inspect` → `{ readOnlyHint: true }`
    - `project.list`, `project.get-meta` → `{ readOnlyHint: true }`
    - `component.delete`, `node.remove`, `variant.remove`, `design.remove-*`,
      `data.remove-*`, `interaction.remove` → `{ destructiveHint: true }`
  - **Confirmed:** All 8 tools use the 4-arg pattern `server.tool(name, desc, schema, handler)`.
    Annotations are per-tool, not per-action. The `node` and `project` tools are mixed
    (read + mutate). Options: (a) omit annotation on mixed tools, (b) use most permissive
    hint, (c) split tools (breaking change). Recommend (a) — annotate only pure tools:
    `inspect` → `readOnlyHint: true`, leave mixed tools unannotated.
  - **Implementation note:** Implemented using the 5-arg overload:
    `server.tool(name, description, schema, annotations, handler)`. Only annotated
    inspect tool with `{ readOnlyHint: true }` per decision (a).

- [x] **P1.4 — `outputSchema` for `listDesignSystem` and `readComponentTree`**
  - **SDK verified:** `outputSchema` supported in SDK 1.27.1 — triggers
    `structuredContent` response instead of `content`
  - **Implementation note (2026-03-04):** Migrated inspect tool from `server.tool()`
    to `server.registerTool()` — the only registration method that supports `outputSchema`.
    Used empty `outputSchema: {}` (permissive) because the SDK requires `structuredContent`
    on ALL non-error returns when `outputSchema` is set, and the inspect tool has 10 actions
    with different output shapes — a per-action schema isn't possible at the SDK level.
    The `inspectResult()` helper returns both `content` (JSON text for backward compat) and
    `structuredContent` (parsed object) from every action. SDK validates via
    `z.object({}).safeParse()` which passes for any object. Tests verify `structuredContent`
    is present on `tree` and `list-design-system` actions.

- [x] **P1.5 — "Design System First" guidance in `design` tool description**
  - Append advisory text to `design` tool description string in `server.ts`
  - Text: prefer token references over raw CSS values IF tokens exist; raw
    values always remain valid (per memory: advisory only, never enforced)

- [x] **P1.6 — Layout Guidance note in `node.updateStyles` description**
  - Append flexbox vs grid guidance to `update-styles` action description
  - When to use flex-row/flex-col vs grid, when to prefer a component over raw tag

- [x] **P1.7 — Few-shot examples in tool/action descriptions**
  - Add concise input→output examples to key action descriptions:
    `inspect.tree`, `inspect.listDesignSystem`, `node.updateStyles`,
    `design.list-tokens`, `node.add`
  - Keep examples as JSON one-liners to minimize prompt token inflation
  - Current descriptions are terse bullet lists with no examples

---

## Priority 2 — HTML Import Bridge (Medium effort, high impact)

**Spec:** `design-html-bridge.md`

Enables the LLM to express designs in HTML/CSS rather than composing many
individual tool calls. Critical path: unlocks P3 (Pattern Library).

- [ ] **P2.1 — `html-importer.ts` module**
  - New file: `packages/plasmic-mcp/src/html-importer.ts`
  - Add `jsdom` to `package.json` dependencies (not currently present;
    `@xmldom/xmldom` exists but is insufficient — need full DOM + `getComputedStyle`)
  - Polyfill `DOMParser`, `document`, `window` via jsdom for `parseHtmlToWebImporterTree`
  - **Confirmed:** `parseHtmlToWebImporterTree` (html-parser.ts line 748) signature is
    `async function parseHtmlToWebImporterTree(htmlString: string, site: Site)` and
    uses browser APIs directly (`new DOMParser()`, `document.querySelectorAll()`,
    `window.getComputedStyle()`) — cannot be imported directly, must be called
    with jsdom globals in scope. Tests exist at `html-parser.spec.ts`.
  - Implement `wiTreeToEditCalls()` mapper — **design for reuse by P3.3**
  - Handle all 4 WIElement types:
    - `WIContainer` → `addChild(tag)` + `updateStyles(safeStyles)`
    - `WIText` → `addChild(tag)` + `updateText(text)` + `updateStyles(safeStyles)`
    - `WISVG` → `addChild("div")` + `updateAttrs({ dangerouslySetInnerHTML })`
    - `WIComponent` → `addChild(componentName)` matching by name in site model
  - Handle style variants (`:hover`, `:focus`) → `createStyleVariant` + `updateStyles`
  - Handle screen variants → match via `listVariants`, `updateStyles` with variant UUID
  - All edit-tool primitives already exist in `edit-tools.ts`: `addChild` (line ~2664),
    `updateStyles` (line ~2122), `updateText` (line ~1480), `updateAttrs` (line ~2634),
    `createStyleVariant` (line ~3060)

- [ ] **P2.2 — `importHtml` node action registration**
  - Add `"import-html"` to node tool action enum in `server.ts` (line ~2195)
  - Schema: `{ parentNodeId: string, html: string, position?: "append" | "prepend" }`
  - Returns `{ rootNodeId: string }`

- [ ] **P2.3 — Unit tests for html-importer**
  - New file: `packages/plasmic-mcp/src/__tests__/html-importer.test.ts`
  - Test: simple `<div>` with inline styles → correct `addChild` + `updateStyles`
  - Test: nested container with text → recursive mapping
  - Test: `:hover` variant → `createStyleVariant` + `updateStyles`
  - Test: `<script>`, `<iframe>` → skipped
  - Test: empty/whitespace HTML → `{ error: "No importable elements found" }`
  - Test: WIComponent name not found → skip with warning
  - Test: `parseHtmlToWebImporterTree` returns null → `{ error: "HTML parse failed" }`

---

## Priority 3 — Pattern Library (Medium effort, high impact)

**Spec:** `design-pattern-library.md`

**Blocked by P2.1** — `applyPattern` reuses `wiTreeToEditCalls()`.

- [ ] **P3.1 — Pattern registry module**
  - New directory: `packages/plasmic-mcp/src/patterns/`
  - New file: `packages/plasmic-mcp/src/patterns/registry.ts`
  - Define `PatternDefinition` type: `{ name, description, tags, previewDescription, customisationKeys, tree: PlasmicElement }`
  - Static array of 8 starter patterns: hero-centered, hero-split, card-basic,
    card-grid, navbar-simple, form-contact, feature-row, footer-simple
  - User-defined patterns from `PLASMIC_MCP_PATTERNS_DIR` env var (default
    `.plasmic/patterns/`) — `*.pattern.json` files merged at startup
  - User patterns take precedence on name collision (per memory: users must be
    able to define their own, registry cannot be hardcoded-only)

- [ ] **P3.2 — `listPatterns` inspect action**
  - Add to inspect tool action enum in `server.ts` (line ~612)
  - Returns `{ name, description, tags, previewDescription }[]`
  - No session required (patterns are static)
  - Annotate with `readOnlyHint: true` (requires P1.3 pattern)

- [ ] **P3.3 — `applyPattern` node action**
  - Add to node tool action enum in `server.ts` (line ~2195)
  - Schema: `{ patternName: string, parentNodeId: string, customisations?: Record<string, string> }`
  - Apply customisations (text substitutions) to PlasmicElement tree before instantiation
  - Convert tree to edit calls via `wiTreeToEditCalls()` from P2.1
  - Returns `{ rootNodeId: string }`
  - Unknown patternName → `{ error: "Pattern 'foo' not found. Call listPatterns to see available patterns." }`

- [ ] **P3.4 — Unit tests for pattern library**
  - New file: `packages/plasmic-mcp/src/__tests__/pattern-library.test.ts`
  - Test: `listPatterns` returns all 8 patterns with correct shape
  - Test: `applyPattern("hero-centered", parentId)` produces expected edit calls
  - Test: customisations substitute values correctly
  - Test: unknown patternName → clear error
  - Test: undeclared customisation key → ignored with warning

---

## Priority 4 — Visual Feedback Loop (Higher effort, lower urgency)

**Spec:** `design-visual-feedback.md`

Requires running dev host; the `VisualCapture` eval class exists but is
evals-only infrastructure (Playwright-based). Lower priority — opt-in,
most valuable for iterative design refinement.

- [ ] **P4.1 — `captureScreenshot` inspect action**
  - Add to inspect tool action enum in `server.ts` (line ~612)
  - Returns base64 PNG with MIME type `image/png` as MCP image content block
  - Adapt `VisualCapture` from `evals/visual/capture.ts` or use dev host
    preview URL — the eval class uses full Playwright Studio auth + iframe
    navigation which may be too heavy for runtime use; consider lighter approach
    using the dev host preview URL endpoint
  - `PLASMIC_DEV_HOST_URL` already wired in `model-loader.ts` (line ~76) and
    `session.ts` (line ~28) for dev host sync
  - Clear error if dev host unavailable: `{ error: "Dev host unavailable. Start with PLASMIC_DEV_HOST_URL." }`
  - 10s timeout with clear error on expiry

- [ ] **P4.2 — Eval scenario for feedback loop**
  - New eval scenario in `eval-runner.test.ts` or new YAML in `evals/scenarios/`
  - Make deliberate wrong design change → `captureScreenshot` → verify LLM correction
  - No existing scenario covers this flow

---

## Dependency Graph

```
P1 (Guidance)  ──────────────────────────→ standalone
P2 (HTML Bridge)  ───────────────────────→ standalone (WAB html-parser exists)
P3 (Pattern Library)  ──→ depends on P2.1 (wiTreeToEditCalls)
P4 (Visual Feedback)  ──→ standalone (eval infra exists)
```

**Recommended build order:** P1 → P2 → P3 → P4

P1 items are pure description/annotation changes that improve all LLM
interactions immediately. P2 unlocks P3. P4 is independent but lower urgency.

---

## Existing Infrastructure (no work needed)

| Asset | Location | Notes |
|---|---|---|
| `parseHtmlToWebImporterTree` | `platform/wab/src/wab/client/web-importer/html-parser.ts` | Uses browser APIs; needs jsdom shim |
| `WIElement` / `WIContainer` / `WIText` / `WISVG` / `WIComponent` types | `platform/wab/src/wab/client/web-importer/types.ts` | JSON-serializable plain objects |
| `VisualCapture` class | `packages/plasmic-mcp/evals/visual/capture.ts` | Playwright-based, evals-only |
| `readTokens()` | `packages/plasmic-mcp/src/token-reader.ts` | Already groups by type, returns `Record<string, TokenInfo[]>` |
| `getAllStyleTokens()` | `packages/plasmic-mcp/src/token-reader.ts` | Includes dependency tokens |
| `deriveLayoutType()` | `packages/plasmic-mcp/src/tree-reader.ts` (lines 832-845) | Returns `"vbox" \| "hbox" \| "box"` — no grid detection |
| `layoutType` field | `packages/plasmic-mcp/src/types.ts` (line 231) | `"vbox" \| "hbox" \| "box"` — no `layoutHint` alias |
| Edit-tool primitives | `packages/plasmic-mcp/src/edit-tools.ts` | `addChild`, `updateStyles`, `updateText`, `updateAttrs`, `createStyleVariant` — all present |
| `PLASMIC_DEV_HOST_URL` | `packages/plasmic-mcp/src/model-loader.ts`, `session.ts` | Already wired for dev host sync |
| MCP SDK `ToolAnnotations` | `@modelcontextprotocol/sdk` v1.27.1 | Supported via `server.tool()` overloads |
| MCP SDK `outputSchema` | `@modelcontextprotocol/sdk` v1.27.1 | Supported; triggers `structuredContent` response |
| All 103 existing MCP actions | `packages/plasmic-mcp/src/server.ts` | Production-quality, fully tested |
| `plasmic-mcp-registry` package | `packages/plasmic-mcp-registry/` | Complete, no spec-related work needed |

---

## Open Questions — RESOLVED

1. **P1.3 annotation granularity — RESOLVED.**
   Confirmed: `ToolAnnotations` in SDK 1.27.1 are per-tool, not per-action
   (verified in `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js`).
   Decision: annotate `inspect` only with `{ readOnlyHint: true }`. All mixed-action
   tools (`node`, `design`, `component`, `variant`, `data`, `interaction`, `project`)
   are left unannotated — implicitly `readOnlyHint: false` (the default).

2. **P2.1 import path — RESOLVED. No issue.**
   `packages/plasmic-mcp/tsconfig.json` already maps `@/wab/client/*` →
   `../../platform/wab/src/wab/client/*`. Import as:
   `import { parseHtmlToWebImporterTree } from "@/wab/client/web-importer/html-parser"`
   This is the same pattern already used in `edit-tools.ts` for `@/wab/shared/*`.

3. **P4.1 implementation weight — RESOLVED.**
   The eval `VisualCapture` class requires full Studio authentication and is too
   heavy for a runtime MCP action. The `plasmic-mcp-registry` package has no
   existing screenshot endpoint.
   **Decision:** Add a `/api/plasmic-screenshot` endpoint to `packages/plasmic-mcp-registry`
   (already runs inside the user's dev host, which renders components natively).
   The endpoint accepts `{ componentName, path? }`, renders the component via the
   dev host's existing Next.js render path, and captures it with Playwright (headless
   Chromium only — no Studio auth required). The MCP calls this endpoint via
   `PLASMIC_DEV_HOST_URL`. P4.1 implementation note updated accordingly.
