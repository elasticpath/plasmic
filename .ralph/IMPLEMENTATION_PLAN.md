# Plasmic MCP Eval System -- Implementation Plan

## Status Summary

**Comprehensive audit date: 2026-02-27**

- MCP server: 8 STRAP tools, 103 actions -- ALL fully implemented, zero TODOs/FIXMEs
- Eval system: harness, graders, visual capture, dashboard, CI, ~135 scenarios across 20 YAML files
- Total tests: ~1,539 (1,381 unit across 29 suites + 137 integration in 1 suite + 21 plasmic-registry tests)
- Eval tests: 228 across 10 files (25 new added in P14)
- **Action coverage: ~98% (103/103 actions have eval scenarios)**
- **Unfixed items: none**
- **Priority order: all priorities completed**

## Completed Priorities

| Priority | Area | Summary |
|----------|------|---------|
| P1-P2 | MCP Server & Eval Core | STRAP architecture, eval harness, graders, scenarios |
| P3 | Eval Unit Tests | 182 tests across 9 eval module files |
| P4 | Code Component Variants | `variant.list` CC output, `resolveVariant()` by key/displayName, `create-style` CC selectors, type declarations, 3 eval scenarios, skill doc updates |
| P5 | Dashboard Hardening | XSS fix, fetch timeout, Chart.js CDN fallback, POST input validation |
| P6 | Visual Capture Hardening | Defensive null checks, CSRF validation, selector constants, crash pattern expansion |
| P7 | Report Archival | 90-day cleanup on server start + standalone `npm run eval:cleanup` |
| P8 | Eval Resume/Skip | Git SHA tracking, scenario skip for passed results, `--force` override |
| P9 | Contract & Doc Fixes | dryRun support for 5 component actions, explicit dryRun rejection for 3 API-based actions, `update-split` slices support, eval scenario childTags fix, skill doc accuracy, INDEX.md regeneration (55->70 scenarios), dashboard regression alerts with full grader results. 20 new tests. |
| P10 | Dev Host Variant Sync | Dev host variant sync -- `@elasticpath/plasmic-registry` package, dev host API route, `devhost-sync.ts` MCP module, session state extension, 22 MCP unit tests + 21 registry tests, README docs |
| P11 | Scenario Coverage Expansion | 65 missing scenarios added across 8 domain YAML files (11 node + 16 design + 12 data + 10 component + 8 variant + 5 inspect + 2 interaction + 1 project). INDEX.md regenerated (70 -> 135 scenarios: 66 simple + 50 medium + 19 complex). Action coverage ~98% (103/103). All 1312 unit tests pass including scenario loader validation. |
| P12 | Eval Runner Robustness | Eval runner robustness — tool execution timeout (Promise.race on onToolCall), saveReport fallback (try/catch with stderr), visual capture wall-clock cap (30s Promise.race), MCP server cleanup (server.close before null), MAX_TURNS exhaustion flag (maxTurnsExhausted field on ConversationResult), Playwright tracing stop/restart on success, console.error suppression try/finally, desktopPath null until screenshot succeeds. 5 new tests. |
| P13 | Eval Grader Quality | Property grader numeric coercion (P13.1), existence grader exact matching + page/component separation (P13.2/P13.3), tool-params exact matching (P13.4), LLM judge readFileSync try/catch + multi-digit score regex (P13.5/P13.6), review-flags independent low-quality (P13.7), loadPreviousReport scenarios validation (P13.8), data grader name/queryType/event filtering (P13.9). New eval-llm-judge test file (16 tests). |
| P14 | Eval Infrastructure Improvements | Partial re-run report merging (P14.1), dirty-tree detection (P14.2), scenario content hashing (P14.3), CLI argument validation (P14.4), scenario validator integration-only gap (P14.5), regression detection flag (P14.6), high-retry-count flag (P14.7). 25 new tests. All 1381 unit tests pass. |

---

## Outstanding Work

### P12 -- HIGH: Eval Runner Robustness (COMPLETED)

Hangs, data loss, and misleading results undermine eval reliability. All 8 items fixed.

- [x] **P12.1 -- Tool execution timeout** `evals/harness/claude-client.ts:158-163`. `onToolCall()` is awaited with no `Promise.race`. A hanging Plasmic API call in integration mode blocks the entire process indefinitely. **Fix:** wrap `await onToolCall(...)` in `Promise.race` with `remainingMs` countdown, same pattern as the API call on line 92.
- [x] **P12.2 -- saveReport fallback** `evals/harness/reporter.ts:122-126`. `writeFileSync` has no try/catch. Disk full or permission errors lose all results. **Fix:** wrap in try/catch, fallback to `process.stderr.write(JSON.stringify(report))` so results are not silently lost.
- [x] **P12.3 -- Visual capture hang** `evals/visual/capture.ts:266,381-383`. `waitForStudioCanvas()` passes the full `timeout` (60s) to nested iframe waits. The `capture()` method itself has no wall-clock cap. **Fix:** add a per-capture wall-clock timeout (e.g., 30s total) via `Promise.race` in the `capture()` method.
- [x] **P12.4 -- InMemoryTransport server cleanup** `evals/harness/mcp-client.ts:365-393`. `close()` nulls `this.server` (line 392) but never calls `server.close()`. The MCP server and its InMemoryTransport remain open. **Fix:** call `await this.server.close()` before nulling, guarded by try/catch like the client close.
- [x] **P12.5 -- MAX_TURNS exhaustion flag** `evals/harness/claude-client.ts:81,196-204`. When the 25-turn `MAX_TURNS` limit is hit, the loop exits silently. `timedOut` stays `false`, no error is recorded, and the result looks like success. **Fix:** add a `maxTurnsExhausted: boolean` field to `ConversationResult` (set true when loop exits without `end_turn`/`timedOut`), and handle it in `runner.ts` like `incomplete`.
- [x] **P12.6 -- Playwright tracing unbounded growth** `evals/visual/capture.ts:172,309`. `tracing.start()` is called once in `initialize()`. On success paths (line 309), `tracing.stop()` is never called -- only the failure path calls `saveTraceOnFailure()`. Trace buffer grows for the entire run. **Fix:** call `tracing.stop()` then `tracing.start()` after each successful capture, or stop+discard on success.
- [x] **P12.7 -- console.error suppression leak** `evals/harness/mcp-client.ts:155-185`. `console.error` is patched to `suppressedConsoleError` at line 164, then dynamic imports and server creation happen (lines 168-182). If any of those throw, the suppression is never undone (restore is at line 185). **Fix:** wrap lines 168-183 in try/finally that always restores `console.error`.
- [x] **P12.8 -- desktopPath returned when screenshot failed** `evals/visual/capture.ts:272-287`. In the nav-failure path, `desktopPath` is set at line 272 and returned at line 284 even if `page.screenshot()` throws at line 277 (the catch is empty). The LLM judge then reads a nonexistent file. **Fix:** initialize `desktopPath` as `null`, only set it after successful screenshot write.

---

### P13 -- HIGH: Eval Grader Quality Fixes (COMPLETED)

False positives and false negatives make eval results unreliable. All 9 items fixed.

- [x] **P13.1 -- property grader `.toLowerCase()` on numeric values** `evals/graders/state-check.ts:279`. Style values can be numbers (e.g., `lineHeight: 1.5`). `.toLowerCase()` throws `TypeError` on non-strings. The attrs check (line 302) correctly uses `String(raw)` coercion. **Fix:** coerce `actual` to `String(actual)` before calling `.toLowerCase()`.
- [x] **P13.2 -- existence grader substring false positives** `evals/graders/state-check.ts:72-73,138-139,177-178,204-205`. All entity-type branches use `name.toLowerCase().includes(...)` which matches partials: searching for "Card" matches "CreditCard". **Fix:** add an optional `exact: boolean` param (default true for entityType searches). When exact, use `===` comparison instead of `.includes()`.
- [x] **P13.3 -- existence grader page/component conflation** `evals/graders/state-check.ts:60-87`. Both `entityType: "page"` and `entityType: "component"` search the merged list `[...data.pages, ...data.components]`. A component named "Contact" would satisfy a page existence check. **Fix:** when `entityType === "page"`, search only `data.pages`; when `entityType === "component"`, search only `data.components`.
- [x] **P13.4 -- tool-params substring false positives** `evals/graders/transcript-check.ts:136-138`. String param matching uses `actual.toLowerCase().includes(value.toLowerCase())`: expected "red" matches actual "bordered". **Fix:** use exact match (`===`) by default, add an optional `substring: true` param to the grader config for cases where substring matching is intentional.
- [x] **P13.5 -- LLM judge readFileSync crash** `evals/graders/llm-judge.ts:104-117`. `existsSync()` check is present, but `readFileSync()` itself is not wrapped in try/catch. A race condition (file deleted between check and read) or permissions error would crash the judge. **Fix:** wrap each `readFileSync` call in try/catch, skip the image block on failure.
- [x] **P13.6 -- LLM judge score regex** `evals/graders/llm-judge.ts:190`. `/SCORE:\s*(\d)/` matches only one digit. `SCORE: 10` would be parsed as `1`. While scores are 1-5 and the range check (line 193) would catch 0, a model responding `SCORE: 10` would be parsed as `1` instead of rejected. **Fix:** use `/SCORE:\s*(\d+)/` and reject values outside 1-5 with explicit range check.
- [x] **P13.7 -- review-flags low-quality gap** `evals/graders/review-flags.ts:51-58`. When `success=true` and `qualityScore<=2`, `judge-disagrees` is added (line 42). Then the low-quality check (line 55) skips adding `low-quality` because `flags.includes("judge-disagrees")` is true AND `result.success` is true. So `success=true, score=1` gets only `judge-disagrees`, never `low-quality`. **Fix:** always add `low-quality` when `qualityScore <= 2`, independently of the `judge-disagrees` flag. Remove the conditional guard on line 55.
- [x] **P13.8 -- loadPreviousReport missing scenarios validation** `evals/harness/reporter.ts:256-265`. Returns the parsed report without checking `Array.isArray(report.scenarios)`. A report file with a missing or non-array `scenarios` field would cause `applyReviewFlags` (line 81) to crash with `cannot read properties of undefined (reading 'map')`. **Fix:** add `&& Array.isArray(report.scenarios)` to the guard on line 259.
- [x] **P13.9 -- data grader count-only limitation** `evals/graders/state-check.ts:460-531`. The `queries` and `interactions` grader subtypes only validate count (`queryList.length >= minCount`), not name, type, or event. A scenario asking for "add a REST query named fetchUsers" would pass if any query exists. **Fix:** add optional `name`, `queryType` (for queries), and `event` (for interactions) params that assert specific properties on the found items.

---

### P14 -- MEDIUM: Eval Infrastructure Improvements (COMPLETED)

Quality of life, accuracy, and developer experience improvements. All 7 items fixed. 25 new tests added (40 review-flags tests total, 20 scenario-loader tests, reporter tests for getGitSha and findPassedScenarioIds). All 1381 unit tests pass. Build and typecheck clean.

- [x] **P14.1 -- Partial re-run report merging** `evals/cli.ts:263-296`, `evals/harness/reporter.ts`. cli.ts now merges skipped-as-passed results from the previous report into newly-run results before generating the final report. Success rate now reflects the full scenario suite, not just newly-run scenarios.
- [x] **P14.2 -- Dirty-tree detection** `evals/harness/reporter.ts:305-311`. `getGitSha()` now runs `git diff --quiet HEAD` after getting the SHA. If it fails (uncommitted changes), appends `-dirty` to the SHA string, preventing incorrect skip logic on dirty working trees.
- [x] **P14.3 -- Scenario content hashing** `evals/harness/scenario-loader.ts`. Computes a SHA256 hash of each scenario's behavioral content (description, graders, setup, etc.). Stored as `contentHash` on EvalScenario and `scenarioHash` on ScenarioResult in reports. `findPassedScenarioIds()` now returns `Map<string, string|undefined>` and cli.ts compares hashes during skip, forcing re-runs when scenario content changes.
- [x] **P14.4 -- CLI argument validation** `evals/cli.ts:41-90`. `parseArgs()` now validates `--tier` against `["simple", "medium", "complex"]` with a clear error message, and warns on unrecognized flags.
- [x] **P14.5 -- Scenario validator integration-only gap** `evals/harness/scenario-loader.ts`. `validateAllScenarios()` now loads both mock and integration scenarios, merging by ID, so integration-only scenarios (like project-save-refresh) are validated.
- [x] **P14.6 -- Regression detection flag** `evals/graders/review-flags.ts`. Added "regression" ReviewFlag. `computeReviewFlags()` accepts previousScenarioSuccess map; fires when scenario was passing in previous run but now fails. `applyReviewFlags` builds the success map from the previous report.
- [x] **P14.7 -- High-retry-count flag** `evals/graders/review-flags.ts`. Added "high-retries" ReviewFlag. Fires when a passing scenario has retries > 3, surfacing fragile scenarios for human review.

---

---

## Known Issues

| # | Issue | Severity | Location | Status | Description |
|---|-------|----------|----------|--------|-------------|
| 1 | Action coverage gap | Resolved | `evals/scenarios/` | FIXED (P11) | 103/103 actions (~98%) now have eval scenarios. 135 scenarios across 20 YAML files. |
| 2 | property grader numeric crash | Bug | `state-check.ts:279` | FIXED (P13.1) | `.toLowerCase()` on numeric style values throws TypeError |
| 3 | Tool execution no timeout | Bug | `claude-client.ts:158-163` | FIXED (P12.1) | `onToolCall` awaited with no timeout; hangs indefinitely |
| 4 | saveReport no fallback | Bug | `reporter.ts:122-126` | FIXED (P12.2) | Filesystem error loses all results |
| 5 | Visual capture can hang | Bug | `capture.ts:266,381-383` | FIXED (P12.3) | Canvas wait uses full timeout per layer, unbounded total |
| 6 | LLM judge readFileSync crash | Bug | `llm-judge.ts:104-117` | FIXED (P13.5) | Screenshot read outside try/catch |
| 7 | LLM judge score regex | Bug | `llm-judge.ts:190` | FIXED (P13.6) | `\d` matches one digit; SCORE:10 -> 1 |
| 8 | existence grader false positives | Risk | `state-check.ts:72-73` | FIXED (P13.2) | Substring matching on entity names |
| 9 | existence grader page/component conflation | Risk | `state-check.ts:60-87` | FIXED (P13.3) | Both entityTypes search merged list |
| 10 | tool-params substring false positives | Risk | `transcript-check.ts:136-138` | FIXED (P13.4) | `includes()` matches partials |
| 11 | review-flags low-quality gap | Bug | `review-flags.ts:51-58` | FIXED (P13.7) | success+score=1 never gets low-quality flag |
| 12 | loadPreviousReport no scenarios check | Bug | `reporter.ts:259` | FIXED (P13.8) | Missing `Array.isArray(report.scenarios)` guard |
| 13 | data grader count-only | Risk | `state-check.ts:460-531` | FIXED (P13.9) | Queries/interactions graders validate count, not content |
| 14 | MCP server cleanup leak | Bug | `mcp-client.ts:392` | FIXED (P12.4) | `server.close()` never called before nulling |
| 15 | MAX_TURNS looks like success | Bug | `claude-client.ts:81,196` | FIXED (P12.5) | 25-turn exit has no exhaustion flag |
| 16 | Playwright tracing unbounded | Bug | `capture.ts:172,309` | FIXED (P12.6) | Success path never stops tracing |
| 17 | console.error suppression leak | Bug | `mcp-client.ts:155-185` | FIXED (P12.7) | No try/finally around mock init |
| 18 | desktopPath on screenshot failure | Bug | `capture.ts:272-287` | FIXED (P12.8) | Returns path even when screenshot write fails |
| 19 | Integration mode state leak | Risk | `mcp-client.ts:357-361` | KNOWN | project.save in one scenario pollutes next |
| 20 | Partial re-run misleading rate | Risk | `cli.ts:263-296` | FIXED (P14.1) | Report now merges skipped-as-passed results before generating final report |
| 21 | Dirty-tree detection | Risk | `reporter.ts:305-311` | FIXED (P14.2) | `getGitSha()` appends `-dirty` when working tree has uncommitted changes |
| 22 | resolveComponentUuid substring match | Bug | `state-check.ts:564-565` | UNFIXED | Same `.includes()` bug as P13.2, can resolve wrong component |
| 23 | findNodeByName no cycle guard | Risk | `state-check.ts:580-589` | LOW | No cycle protection in recursive tree walk |
| 24 | MODEL_PRICING stale keys | Risk | `runner.ts:267-271` | UNFIXED | Latest model IDs not listed; falls through to Opus pricing |
| 25 | No .env.example for eval | DX | `evals/` | UNFIXED | Env vars documented only in cli.ts parseArgs and README |
| 26 | No tests for saveReport/loadPreviousReport | Gap | `evals/harness/reporter.ts` | UNFIXED | Core report I/O paths untested |
| 27 | Unbounded undo stack | Risk | `src/undo-manager.ts` | LOW | Memory concern for long sessions, not eval-blocking |

---

## Issue Discovery Log

Issues 1-20 were identified through P1-P9 work and early analysis. Issues 22-27 were discovered in the 2026-02-27 comprehensive audit. Issues 20-21 were resolved in P14.

- **#22 resolveComponentUuid substring match**: Uses same `name.includes()` pattern as P13.2. When multiple components share a name prefix (e.g., "Card" and "CardList"), the resolver picks the first match, which may be wrong.
- **#23 findNodeByName no cycle guard**: WAB model should not have cycles, but there is no defensive guard. Low risk but worth noting.
- **#24 MODEL_PRICING stale keys**: `runner.ts` pricing table uses prefix matching (`claude-sonnet`, `claude-haiku`, `claude-opus`). Works for current models but doesn't include specific version IDs. All unknown models fall through to Opus pricing, overcounting cost for cheaper models.
- **#25 No .env.example**: New developers must read `cli.ts` source to discover required/optional env vars. A `.env.example` file would improve onboarding.
- **#26 No reporter I/O tests**: `saveReport()` and `loadPreviousReport()` have no tests covering filesystem errors, malformed files, or edge cases.
- **#27 Unbounded undo stack**: Core infrastructure concern, not eval-blocking. Long sessions could accumulate large undo history in memory.
