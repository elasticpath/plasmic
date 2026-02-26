# Plasmic MCP Eval System — Implementation Plan

## Status Summary

**Complete**: MCP server (8 STRAP tools, 103 actions), eval harness (cli, runner, claude-client, mcp-client, scenario-loader, scenario-validator, reporter, types), 8 grader types + LLM judge + review flags, visual capture (Playwright), dashboard (Chart.js), CI workflow, 67 scenarios (20 simple / 32 medium / 15 complex), 42 eval tests, package scripts. P1 (scenario coverage gaps) and P2 (unused grader activation) fully complete. state-check.ts enhanced with `componentName` resolution as alternative to `componentUuid`; scenario-validator.ts updated to accept `componentName`.

**In progress**: P3 Eval Module Unit Tests is the next priority. P4 Code Component Variant Support — P4.1-P4.4 complete (type declarations, listVariants, resolveVariant, createStyleVariant all support code component variants with 16 new unit tests). P4.5 (eval scenarios) remains.

**Goal**: Close remaining gaps in scenario coverage, grader utilization, test coverage, and robustness so the eval system reliably measures Claude's ability to complete Plasmic design tasks across all 8 STRAP domains.

---

## Prioritized Task List

### P3: Eval Module Unit Tests — `src/__tests__/`
_Impact: MEDIUM — harness code has zero unit tests. Regressions in runner/reporter/loader could silently corrupt eval results._

- [ ] **P3.1 — runner.ts tests**
  - Test scenario execution flow, cost accumulation, retry counting, timeout enforcement, error handling
  - Files: new `src/__tests__/eval-runner.test.ts`
  - AC: >= 10 tests covering happy path, retry logic, cost-limit abort, error propagation

- [ ] **P3.2 — claude-client.ts tests**
  - Test conversation management, timeout handling, tool call routing, message formatting
  - Files: new `src/__tests__/eval-claude-client.test.ts`
  - AC: >= 8 tests covering tool dispatch, timeout, conversation state

- [ ] **P3.3 — mcp-client.ts tests**
  - Test mock vs integration mode switching, tool call dispatch to correct domain handler, project reset between scenarios
  - Files: new `src/__tests__/eval-mcp-client.test.ts`
  - AC: >= 8 tests covering both modes, tool routing, reset logic

- [ ] **P3.4 — scenario-loader.ts tests**
  - Test YAML loading, validation integration, tier/domain filtering, malformed input handling
  - Files: new `src/__tests__/eval-scenario-loader.test.ts`
  - AC: >= 6 tests covering load, filter, validation errors

- [ ] **P3.5 — reporter.ts tests**
  - Test report generation, aggregate stat computation, review flag application, JSON output format
  - Files: new `src/__tests__/eval-reporter.test.ts`
  - AC: >= 8 tests covering report structure, aggregation, flag merging

- [ ] **P3.6 — transcript-check.ts tests**
  - Test tool-sequence matching (exact, subset, ordered), tool-params validation, count assertions, no-errors detection
  - Files: new `src/__tests__/eval-transcript-check.test.ts`
  - AC: >= 10 tests covering all 4 transcript grader types

- [ ] **P3.7 — state-check.ts tests**
  - Test existence, property, structure, data grader logic against mock component state
  - Files: new `src/__tests__/eval-state-check.test.ts`
  - AC: >= 12 tests covering all 4 state grader types including edge cases

### P4: Code Component Variant Support — `src/`
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

- [ ] **P4.5 — Add eval scenarios for code component variants**
  - 1 simple (list code component variants), 1 medium (resolve and apply styles to code component variant), 1 complex (create style variant with code component selector + apply styles)
  - Files: `evals/scenarios/variant.yaml`
  - AC: 3 new scenarios; `eval:validate` passes

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
