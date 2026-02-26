# Plasmic MCP Eval System — Implementation Plan

## Status Summary

**Complete**: MCP server (8 STRAP tools, 103 actions), eval harness (cli, runner, claude-client, mcp-client, scenario-loader, scenario-validator, reporter, types), 8 grader types + LLM judge + review flags, visual capture (Playwright), dashboard (Chart.js), CI workflow, 70 scenarios (21 simple / 30 medium / 19 complex), package scripts. P1-P4 fully complete. **P4 Code Component Variant Support fully complete** — P4.1-P4.4 (type declarations, listVariants, resolveVariant, createStyleVariant with 16 unit tests) and P4.5 (3 eval scenarios: simple list, medium resolve+style, complex create-style+apply). Total tests: 1,407. Total scenarios: 70.

**In progress**: P5-P8 hardening tasks. Next: P5 Dashboard Hardening.

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

### P5: Dashboard Hardening — `evals/dashboard/`
_Impact: LOW-MEDIUM — security and reliability improvements for the results dashboard._

- [ ] **P5.1 — Fix XSS in onclick handlers**
  - Replace inline `onclick` handlers with data attributes + event delegation; ensure `esc()` covers attribute contexts
  - Files: `evals/dashboard/index.html`
  - AC: No inline JS event handlers in HTML; scenario names with `<script>` or `"onmouseover=` are rendered safely

- [ ] **P5.2 — Add fetch timeout**
  - Wrap all `fetch()` calls with `AbortController` (30s timeout); show error message on timeout
  - Files: `evals/dashboard/index.html`
  - AC: Dashboard shows "Request timed out" after 30s if server is unresponsive

- [ ] **P5.3 — Add Chart.js CDN fallback**
  - Add `onerror` handler on CDN script tag that loads local bundle or shows "Charts unavailable" message
  - Files: `evals/dashboard/index.html`
  - AC: Page is functional (shows data, no blank screen) when CDN is unreachable

- [ ] **P5.4 — Validate POST /api/overrides input**
  - Validate scenarioId format, reject unexpected fields, sanitize override values
  - Files: `evals/dashboard/render.js`
  - AC: Malformed POST bodies return 400 with descriptive error

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
