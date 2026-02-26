# Plasmic MCP Eval System — Implementation Plan

## Status Summary

**Complete**: MCP server (8 STRAP tools, 103 actions), eval harness, graders, visual capture, dashboard, CI, 70 scenarios. P1-P4 fully complete. **P5 Dashboard Hardening fully complete** — XSS fix (data attributes + event delegation + escAttr()), fetch timeout (30s AbortController), Chart.js CDN fallback (onerror + guard), POST /api/overrides input validation (allowlist + type checks + length caps). Total tests: 1,407.

**In progress**: P6-P8 hardening tasks. Next: P6 Visual Capture Hardening.

**Goal**: Close remaining gaps in scenario coverage, grader utilization, test coverage, and robustness so the eval system reliably measures Claude's ability to complete Plasmic design tasks across all 8 STRAP domains.

---

## Prioritized Task List

### P3: Eval Module Unit Tests — `src/__tests__/` ✅ COMPLETE
_Impact: MEDIUM — 148 new tests ensure regressions in runner/reporter/loader/graders are caught immediately._

- [x] **P3.1 — runner.ts tests** (18 tests) — `src/__tests__/eval-runner.test.ts`
- [x] **P3.2 — claude-client.ts tests** (12 tests) — `src/__tests__/eval-claude-client.test.ts`
- [x] **P3.3 — mcp-client.ts tests** (12 tests) — `src/__tests__/eval-mcp-client.test.ts`
- [x] **P3.4 — scenario-loader.ts tests** (14 tests) — `src/__tests__/eval-scenario-loader.test.ts`
- [x] **P3.5 — reporter.ts tests** (19 tests) — `src/__tests__/eval-reporter.test.ts`
- [x] **P3.6 — transcript-check.ts tests** (28 tests) — `src/__tests__/eval-transcript-check.test.ts`
- [x] **P3.7 — state-check.ts tests** (45 tests) — `src/__tests__/eval-state-check.test.ts`

### P4: Code Component Variant Support — `src/` ✅ COMPLETE
_Impact: MEDIUM — new MCP feature that unlocks eval scenarios for an untested variant type. Spec complete at `.ralph/specs/code-component-variant-support.md`._

- [x] **P4.1 — Implement `variant.list` code component variant output**
  - Add `codeComponentVariants` array to list response with uuid, key, displayName, cssSelector, codeComponentName, invalid flag
  - Files: `src/edit-tools.ts`, `src/server.ts`, `src/wab.d.ts`
  - AC: `variant.list` on a component with code component root returns populated `codeComponentVariants` array; unit tests pass

- [x] **P4.2 — Implement `resolveVariant()` code component variant resolution**
  - Match by key (case-insensitive) and displayName (case-insensitive) in addition to existing UUID matching
  - Files: `src/edit-tools.ts`
  - AC: `resolveVariant("selected")` finds the code component variant; unit tests cover key, displayName, UUID paths

- [x] **P4.3 — Implement `variant.create-style` code component selector support**
  - Accept registered `CodeComponentVariantMeta.cssSelector` values (e.g., `[data-selected]`) when component root is a code component with variants
  - Files: `src/edit-tools.ts`, `src/server.ts`
  - AC: `create-style` with `[data-selected]` succeeds on valid component, fails on non-code-component; unit tests pass

- [x] **P4.4 — Add type declarations**
  - Declare `codeComponentName`, `codeComponentVariantKeys` on Variant; `CodeComponentVariantMeta`; `variants` on `CodeComponentMeta`
  - Files: `src/wab.d.ts`
  - AC: `tsc --noEmit` passes

- [x] **P4.5 — Add eval scenarios for code component variants**
  - 3 scenarios added to `evals/scenarios/variant.yaml`: `variant-list-code-component` (simple), `variant-resolve-code-component` (medium), `variant-create-style-code-component` (complex)
  - Files: `evals/scenarios/variant.yaml`
  - AC: ✅ 3 new scenarios; `eval:validate` passes (70 total scenarios)

### P5: Dashboard Hardening — `evals/dashboard/` ✅ COMPLETE
_Impact: LOW-MEDIUM — security and reliability improvements for the results dashboard._

- [x] **P5.1 — Fix XSS in onclick handlers**
  - Replaced all inline `onclick` handlers with `data-action`/`data-scenario-id` attributes + event delegation on `app`
  - Added `escAttr()` function that escapes `"` and `'` for safe attribute context usage
  - Replaced `getElementById` lookups with `querySelector` using `data-form-for`/`data-field` + `CSS.escape()`
  - Files: `evals/dashboard/index.html`
  - AC: ✅ Zero inline JS event handlers; scenario names with special chars are rendered safely

- [x] **P5.2 — Add fetch timeout**
  - Added `fetchWithTimeout()` helper using `AbortController` with 30s timeout
  - All `fetch()` calls replaced: `init()` reports+overrides, `submitOverride()` POST
  - Timeout shows "Request Timed Out" message; other errors show "Connection Error"
  - Files: `evals/dashboard/index.html`
  - AC: ✅ Dashboard shows "Request timed out" after 30s if server is unresponsive

- [x] **P5.3 — Add Chart.js CDN fallback**
  - Added `onerror` on CDN script tag setting `window.__chartJsUnavailable = true`
  - Chart rendering guarded by `typeof Chart !== "undefined" && !window.__chartJsUnavailable`
  - Hidden banner `#chart-fallback-msg` shown when CDN fails
  - Files: `evals/dashboard/index.html`
  - AC: ✅ Page shows data tables and "Charts unavailable" message when CDN is unreachable

- [x] **P5.4 — Validate POST /api/overrides input**
  - Allowlist: only `scenarioId`, `overrideSuccess`, `notes`, `reviewedBy` accepted; unexpected fields return 400
  - `scenarioId` validated against `/^[a-zA-Z0-9_-]+$/` pattern
  - Type checks: `overrideSuccess` must be boolean, `notes`/`reviewedBy` must be strings
  - Length caps: notes 2000 chars, reviewedBy 200 chars
  - No more `...override` spread — sanitized object built from validated fields only
  - Files: `evals/dashboard/render.js`
  - AC: ✅ Malformed POST bodies return 400 with descriptive error

### P6: Visual Capture Hardening — `evals/visual/`
_Impact: LOW-MEDIUM — defensive fixes to prevent silent failures in screenshot capture._

- [ ] **P6.1 — Replace non-null assertions with defensive checks**
  - Replace `this.page!.goto(...)` etc. with null guards that throw descriptive errors
  - Files: `evals/visual/capture.ts`
  - AC: Every `this.page` / `this.browser` / `this.context` access has a null check; no `!` assertions remain

- [ ] **P6.2 — Add CSRF response validation**
  - Validate that `csrfRes1.json()` has a `csrf` property before using it; throw descriptive error if missing
  - Files: `evals/visual/auth.ts`
  - AC: Missing CSRF token produces a clear error message instead of `undefined` propagation

- [ ] **P6.3 — Extract hardcoded frame selectors to constants**
  - Move `.studio-frame`, `.__wab_studio-frame`, `.canvas-editor__canvas-container` to a `SELECTORS` const object
  - Files: `evals/visual/capture.ts`
  - AC: All frame selectors referenced via named constants; single point of update

- [ ] **P6.4 — Expand crash detection patterns**
  - Add patterns for common Playwright/browser crashes beyond the current 3; increase `isVisible()` timeout from 500ms to 2000ms
  - Files: `evals/visual/capture.ts`
  - AC: At least 6 error patterns trigger browser relaunch; overlay dismissal succeeds on slower Studio loads

### P7: Eval Report Archival — `evals/dashboard/render.js`, `evals/results/`
_Impact: LOW — prevents unbounded disk usage from accumulated eval results and screenshots._

- [ ] **P7.1 — Implement actual 90-day cleanup**
  - Add a cleanup function that deletes result JSON and screenshot files older than 90 days; invoke on dashboard server startup and via a `eval:cleanup` script
  - Files: `evals/dashboard/render.js`, `package.json`
  - AC: Files in `evals/results/` older than 90 days are deleted on server start; `npm run eval:cleanup` works standalone

### P8: Eval Resume/Skip — `evals/harness/runner.ts`
_Impact: LOW — saves API costs on interrupted runs, but only matters for full nightly runs._

- [ ] **P8.1 — Implement scenario skip for completed results**
  - On run start, check `evals/results/` for existing results matching the current scenario set; skip scenarios that already have a passing result from the same git SHA
  - Add `--force` flag to override and re-run all
  - Files: `evals/harness/runner.ts`, `evals/cli.ts`
  - AC: Interrupted run can be resumed; already-passed scenarios are skipped; `--force` re-runs everything; cost savings logged
