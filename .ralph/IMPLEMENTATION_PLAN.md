# Plasmic MCP Eval System — Implementation Plan

## Status Summary

**Complete**: MCP server (8 STRAP tools, 103 actions), eval harness, graders, visual capture, dashboard, CI, 70 scenarios. P1-P4 fully complete. **P5 Dashboard Hardening fully complete** — XSS fix (data attributes + event delegation + escAttr()), fetch timeout (30s AbortController), Chart.js CDN fallback (onerror + guard), POST /api/overrides input validation (allowlist + type checks + length caps). Total tests: 1,407.

**All tasks complete**. P1-P8 fully implemented.

**Goal**: Close remaining gaps in scenario coverage, grader utilization, test coverage, and robustness so the eval system reliably measures Claude's ability to complete Plasmic design tasks across all 8 STRAP domains.

---

## Prioritized Task List

### P3: Eval Module Unit Tests ✅ COMPLETE (148 tests across 7 files)

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

### P6: Visual Capture Hardening — `evals/visual/` ✅ COMPLETE
_Impact: LOW-MEDIUM — defensive fixes to prevent silent failures in screenshot capture._

- [x] **P6.1 — Replace non-null assertions with defensive checks**
  - Added `requirePage()` helper that throws descriptive error if page is null
  - All `this.page!` usages replaced with `const page = this.requirePage()` + local `page` variable
  - Files: `evals/visual/capture.ts`
  - AC: ✅ Zero `!` assertions remain; null page throws "Visual capture page not initialized"

- [x] **P6.2 — Add CSRF response validation**
  - Validates `csrfBody1?.csrf` exists and is a string before using it
  - Error message includes truncated response body for debugging
  - Files: `evals/visual/auth.ts`
  - AC: ✅ Missing CSRF token produces clear error with response body context

- [x] **P6.3 — Extract hardcoded frame selectors to constants**
  - Added `SELECTORS` const object with `outerFrame`, `innerFrame`, `canvasContainer`, `errorOverlay`
  - All hardcoded selector strings replaced with `SELECTORS.*` references
  - Files: `evals/visual/capture.ts`
  - AC: ✅ All frame selectors via named constants; single point of update

- [x] **P6.4 — Expand crash detection patterns**
  - Added `CRASH_PATTERNS` array with 6 patterns (was 3 inline): added "Target page, context or browser has been closed", "Connection refused", "Session closed"
  - Crash detection now uses `CRASH_PATTERNS.some(p => err.message.includes(p))`
  - Overlay `isVisible()` timeout increased from 500ms to 2000ms for slower Studio loads
  - Files: `evals/visual/capture.ts`
  - AC: ✅ 6 error patterns trigger relaunch; overlay timeout increased to 2000ms

### P7: Eval Report Archival — `evals/dashboard/render.js`, `evals/results/` ✅ COMPLETE
_Impact: LOW — prevents unbounded disk usage from accumulated eval results and screenshots._

- [x] **P7.1 — Implement actual 90-day cleanup**
  - Added `cleanupOldResults()` function to `render.js`: deletes JSON reports by timestamp and screenshot dirs by mtime
  - Runs automatically on dashboard server startup
  - Standalone via `npm run eval:cleanup` (uses `--cleanup-only` flag)
  - Files: `evals/dashboard/render.js`, `package.json`
  - AC: ✅ Files older than 90 days are deleted on server start; `npm run eval:cleanup` works standalone

### P8: Eval Resume/Skip — `evals/harness/reporter.ts`, `evals/cli.ts` ✅ COMPLETE
_Impact: LOW — saves API costs on interrupted runs, but only matters for full nightly runs._

- [x] **P8.1 — Implement scenario skip for completed results**
  - Added `gitSha` field to EvalReport (types.ts) and `getGitSha()` helper (reporter.ts)
  - Reports now record the git commit SHA at generation time
  - `findPassedScenarioIds(gitSha)` scans existing reports for matching SHA
  - cli.ts skips scenarios that already passed for current git SHA; logs skip count
  - `--force` flag overrides skip behavior; help text updated
  - Files: `evals/harness/types.ts`, `evals/harness/reporter.ts`, `evals/cli.ts`
  - AC: ✅ Interrupted runs resumable; passed scenarios skipped; `--force` re-runs all; cost savings logged
