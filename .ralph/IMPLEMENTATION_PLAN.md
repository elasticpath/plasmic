# Plasmic MCP Eval System -- Implementation Plan

## Status Summary

**Comprehensive audit date: 2026-02-27**

- MCP server: 8 STRAP tools, 103 actions -- ALL fully implemented, zero TODOs/FIXMEs
- Eval system: harness, graders, visual capture, dashboard, CI, ~135 scenarios across 20 YAML files
- Total tests: ~1,575 (1,407 unit across 29 suites + 147 integration in 2 suites + 21 plasmic-registry tests)
- Eval tests: 249 across 10 files (21 new added in P15)
- **Action coverage: ~98% (103/103 actions have eval scenarios)**
- **All known issues resolved**
- **Priority order: P1-P17 completed**

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
| P10 | Dev Host Variant Sync | Dev host variant sync -- `@elasticpath/plasmic-registry` package, dev host API route, `devhost-sync.ts` MCP module, session state extension, 22 MCP unit tests + 10 integration tests + 21 registry tests, README docs |
| P11 | Scenario Coverage Expansion | 65 missing scenarios added across 8 domain YAML files (11 node + 16 design + 12 data + 10 component + 8 variant + 5 inspect + 2 interaction + 1 project). INDEX.md regenerated (70 -> 135 scenarios: 66 simple + 50 medium + 19 complex). Action coverage ~98% (103/103). All 1312 unit tests pass including scenario loader validation. |
| P12 | Eval Runner Robustness | Eval runner robustness — tool execution timeout (Promise.race on onToolCall), saveReport fallback (try/catch with stderr), visual capture wall-clock cap (30s Promise.race), MCP server cleanup (server.close before null), MAX_TURNS exhaustion flag (maxTurnsExhausted field on ConversationResult), Playwright tracing stop/restart on success, console.error suppression try/finally, desktopPath null until screenshot succeeds. 5 new tests. |
| P13 | Eval Grader Quality | Property grader numeric coercion (P13.1), existence grader exact matching + page/component separation (P13.2/P13.3), tool-params exact matching (P13.4), LLM judge readFileSync try/catch + multi-digit score regex (P13.5/P13.6), review-flags independent low-quality (P13.7), loadPreviousReport scenarios validation (P13.8), data grader name/queryType/event filtering (P13.9). New eval-llm-judge test file (16 tests). |
| P14 | Eval Infrastructure Improvements | Partial re-run report merging (P14.1), dirty-tree detection (P14.2), scenario content hashing (P14.3), CLI argument validation (P14.4), scenario validator integration-only gap (P14.5), regression detection flag (P14.6), high-retry-count flag (P14.7). 25 new tests. All 1381 unit tests pass. |
| P15 | Remaining Bug Fixes & Test Gaps | resolveComponentUuid exact matching (#22), API client session state leak (#19), undo stack MAX_UNDO_DEPTH=50 (#27), MODEL_PRICING versioned IDs (#24), reporter test coverage — saveReport/printSummary/loadOverrides/saveOverride + clearSessionState + undo depth (#26). 21 new tests. All 1402 unit tests pass. |
| P16 | Dev Host Sync Integration Tests | devhost-sync integration tests against real WAB model classes (10 tests). Bug fix: `findWrapperComponents` `_type` → `typeTag ?? _type` for real WAB instance compatibility (#28). Tests verify: syncVariantMetadata on real MobX-observed components, ensureVariantObjects with real TplComponent detection, listVariants/resolveVariant end-to-end with synced data. All 1402 unit + 147 integration tests pass. |
| P17 | Final Defensive Fixes | Cycle guard for `flattenWithPaths` in node-resolver.ts (#23): visited-UUID Set + MAX_TREE_DEPTH=200 depth limit prevent infinite recursion on malformed models. `.env.example` for eval system (#25): documents all required/optional env vars for new developer onboarding. 5 new tests. All 1407 unit + 147 integration tests pass. |

---

## Outstanding Work

*No outstanding work items. All known issues resolved (P1-P17).*

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
| 19 | Integration mode state leak | Risk | `api-client.ts:41-45` | FIXED (P15) | API client cookies/CSRF leaked between project.set calls. Added `clearSessionState()` called in project.set handler. |
| 20 | Partial re-run misleading rate | Risk | `cli.ts:263-296` | FIXED (P14.1) | Report now merges skipped-as-passed results before generating final report |
| 21 | Dirty-tree detection | Risk | `reporter.ts:305-311` | FIXED (P14.2) | `getGitSha()` appends `-dirty` when working tree has uncommitted changes |
| 22 | resolveComponentUuid substring match | Bug | `state-check.ts:651-652` | FIXED (P15) | Replaced `.includes()` with `matchEntityName()` exact matching |
| 23 | flattenWithPaths no cycle guard | Risk | `node-resolver.ts:223` | FIXED (P17) | Added visited-UUID Set + MAX_TREE_DEPTH=200 depth limit. 5 new tests. |
| 24 | MODEL_PRICING stale keys | Risk | `runner.ts:280-287` | FIXED (P15) | Added versioned model ID entries (claude-sonnet-4, claude-haiku-4, claude-opus-4) |
| 25 | No .env.example for eval | DX | `evals/` | FIXED (P17) | Created `evals/.env.example` documenting all required/optional env vars (ANTHROPIC_API_KEY, PLASMIC_AUTH_*, EVAL_PROJECT_ID, PLASMIC_STUDIO_*, EVAL_DASHBOARD_PORT). |
| 26 | No tests for saveReport/loadPreviousReport | Gap | `evals/harness/reporter.ts` | FIXED (P15) | Added 21 tests: saveReport (4), printSummary (7), loadOverrides (3), saveOverride (3), clearSessionState (1), undo depth limit (3) |
| 27 | Unbounded undo stack | Risk | `src/undo-manager.ts` | FIXED (P15) | Added MAX_UNDO_DEPTH=50 limit, oldest ops dropped when exceeded |
| 28 | findWrapperComponents _type check | Bug | `src/devhost-sync.ts:169` | FIXED (P16) | Checked `_type` but real WAB instances use `typeTag` getter. Changed to `typeTag ?? _type` fallback. |

---

## Issue Discovery Log

Issues 1-20 identified P1-P9. Issues 22-27 discovered 2026-02-27 audit. Issues 20-21 resolved P14. Issues 19, 22, 24, 26, 27 resolved P15. Issue 28 discovered and resolved P16. Issues 23, 25 resolved P17.
