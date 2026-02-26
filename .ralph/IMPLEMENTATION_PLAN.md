# Implementation Plan: Plasmic MCP Eval System

> Last updated: 2026-02-26 (P3.2 complete — all planned tasks done)
> Source: `.ralph/specs/mcp-eval-framework.md`, `mcp-eval-scenarios.md`, `mcp-eval-grading.md`, `mcp-eval-visual-capture.md`

## Status Summary

**P0 (Foundation): DONE.** All 4 sub-tasks implemented — directory scaffolding, MCP client adapter, scenario schema/loader, and eval runner with Claude client.
**P1 (Core): DONE.** All 5 sub-tasks implemented — grader framework, 10 scenarios, JSON reporter, CLI, and CI workflow.
**P2 (Enhancement): DONE.** P2.1 done (20 medium scenarios). P2.2 done (15 complex scenarios). P2.3 done (visual capture). P2.4 done (LLM-as-Judge). P2.5 done (integration-tier MCP client).
**P3 (Polish): DONE.** P3.1 done (dashboard). P3.2 done (human review workflow). P3.3 done (20 simple scenarios). P3.4 done (scenario validator). P3.5 done (cost tracking).

### Codebase Health (verified 2026-02-26)
- Zero TODO/FIXME/HACK comments in `packages/plasmic-mcp/`
- Zero skipped or flaky tests
- Zero placeholder or stub implementations (all stubs are intentional mock infrastructure)
- All 1243 tests passing (1106 unit + 137 integration)
- Eval system files implemented:
  - `evals/harness/mcp-client.ts` — McpEvalClient (mock mode via InMemoryTransport; integration mode via StdioClientTransport child process)
  - `evals/harness/types.ts` — EvalScenario, GraderConfig, SetupStep, TranscriptEntry, etc.
  - `evals/harness/scenario-loader.ts` — YAML loading, validation, filtering
  - `evals/harness/scenario-validator.ts` — Standalone validator; unique IDs, valid domains, grader types, setup steps, tier targets
  - `evals/harness/runner.ts` — runScenario, runAll (returns RunAllResult with totalCostDollars); setup step failures abort scenario
  - `evals/harness/claude-client.ts` — Multi-turn conversation loop with timeout, tool routing; retries computed from transcript
  - `evals/harness/reporter.ts` — generateReport, saveReport, printSummary; aggregate includes totalCostDollars
  - `evals/graders/index.ts` — Grader registry
  - `evals/graders/transcript-check.ts` — tool-sequence, tool-params, count, no-errors
  - `evals/graders/state-check.ts` — existence, property, structure, data; state graders pass maxChars: -1 to avoid truncation false negatives; property grader coerces attr values to string before comparison
  - `evals/graders/review-flags.ts` — Auto-flagging logic for human review (judge-disagrees, low-quality, new-scenario); applyReviewFlags mutates results
  - `evals/scenarios/` — 55 YAML scenarios (20 simple + 20 medium + 15 complex)
  - `evals/cli.ts` — CLI entry point with all flags; eval:validate script
  - `evals/dashboard/index.html` — Static dashboard with Chart.js visualizations (6 charts, summary cards, regression alerts, error rate table, run history)
  - `evals/dashboard/render.js` — Node.js HTTP server; serves dashboard HTML and /api/reports endpoint with 90-day retention filter
  - `evals/visual/auth.ts` — Studio CSRF→login authentication for Playwright sessions
  - `evals/visual/capture.ts` — VisualCapture class: Playwright browser lifecycle, Studio navigation, desktop/mobile screenshots
  - `evals/` CI workflow: `.github/workflows/plasmic-mcp-eval.yml`

### Reusable Infrastructure (already exists)
- `createServer()` export from `server.ts` — returns `McpServer` with all 8 tools
- `InMemoryTransport.createLinkedPair()` — in-process client/server pairs (used in tests)
- `client.listTools()` — programmatic tool schema extraction (returns JSON Schema from Zod)
- Bundle fixture: `platform/wab/cypress/bundles/active-screen-variant-group.json`
- Test helpers: `mockApiClient()`, `makeSession()`, `mkTag()`, `mkComponent()`
- Auth mocking pattern: `process.env.PLASMIC_AUTH_*` + stubbed `fetch()`
- Vitest workspace: unit (mocked WAB) and integration (real WAB) projects

---

## P0 — Foundation (must exist before anything else works)

**Status: DONE**

### P0.1: Eval directory structure and package scaffolding
- [x] Create `packages/plasmic-mcp/evals/` directory tree:
  - `evals/scenarios/` — YAML scenario definitions (by domain + cross-domain)
  - `evals/graders/` — State-check grader implementations
  - `evals/harness/` — Eval runner, MCP client adapter, result collector
  - `evals/results/` — Output directory (gitignored except `.gitkeep`)
  - `evals/results/screenshots/` — Visual capture output (gitignored)
- [x] Add `evals/results/` to `.gitignore`
- [x] Add devDependencies to `packages/plasmic-mcp/package.json`: `@anthropic-ai/sdk` (Claude API), `yaml` (scenario parsing)
- **Spec**: mcp-eval-framework.md
- **Dependencies**: None
- **Files**: `packages/plasmic-mcp/evals/`, `packages/plasmic-mcp/package.json` (devDeps)

### P0.2: MCP client adapter for eval harness
- [x] Build programmatic MCP client that calls the 8 STRAP domain tools via MCP protocol
- [x] **Mock mode**: Import `createServer()` from `server.ts`, use `InMemoryTransport` to create client/server pair in-process. Set up env vars so `getAuth()` succeeds with mock credentials. Mock `fetch()` to return bundle fixture (same pattern as `real-integration.test.ts`)
- [x] Expose `callTool(domain, params)` method that sends tool calls and returns JSON results
- [x] Expose `listTools()` method that returns tool definitions as Anthropic API `Tool[]` format (from `client.listTools()` JSON Schema → Anthropic SDK tool shape)
- [x] Handle environment variable validation: fail fast with clear error if `ANTHROPIC_API_KEY` is missing (spec edge case EC4)
- **Spec**: mcp-eval-framework.md
- **Dependencies**: P0.1
- **Files**: `evals/harness/mcp-client.ts`

### P0.3: Scenario schema and loader
- [x] Define TypeScript interfaces: `EvalScenario`, `GraderConfig`, `SetupStep`
- [x] Build YAML loader that reads + validates scenario files
- [x] Validate: unique scenario IDs, valid domain names, valid grader types
- [x] Warn (don't error) if a scenario has no graders defined — track but don't affect pass rate (spec edge case EC6)
- **Schema**:
  ```typescript
  interface EvalScenario {
    id: string;                          // e.g., "design-list-tokens"
    description: string;                 // Natural-language task prompt
    domains: string[];                   // Expected STRAP domains
    tier: "simple" | "medium" | "complex";
    graders: GraderConfig[];             // State checks to run after task
    timeout: number;                     // Seconds before timeout
    setup?: SetupStep[];                 // Optional: tool calls to set up preconditions
    visual?: { rubric: string };         // Optional: LLM judge rubric (P2)
  }
  interface GraderConfig {
    type: "existence" | "property" | "structure" | "count" | "data" | "tool-sequence" | "tool-params" | "no-errors";
    params: Record<string, unknown>;
  }
  interface SetupStep {
    tool: string;                        // Domain tool name
    params: Record<string, unknown>;     // Tool parameters
  }
  ```
- **Key pattern**: Scenarios with `setup` steps run those tool calls before handing the prompt to Claude. This lets scenarios assume certain project state (e.g., "a project is loaded").
- **Spec**: mcp-eval-scenarios.md
- **Dependencies**: P0.1
- **Files**: `evals/harness/types.ts`, `evals/harness/scenario-loader.ts`

### P0.4: Minimal eval runner (end-to-end loop for ONE scenario)
- [x] Core eval loop that executes a single scenario end-to-end:
  1. Load scenario YAML
  2. Initialize MCP client (mock mode)
  3. Run setup steps (if any) — direct tool calls, not via Claude
  4. Send the scenario's `description` as a user message to Claude via Anthropic SDK, with the 8 STRAP tools registered as tool definitions
  5. Handle Claude's `tool_use` responses by routing them to the MCP client
  6. Continue the conversation until Claude produces a final text response (no more tool calls) or timeout
  7. Collect transcript: every message (user, assistant, tool results)
  8. Run state-check graders against the final project state (via MCP inspect calls)
  9. Produce a per-scenario result object with pass/fail, metrics, transcript
- [x] Handle edge case: Claude asks clarifying questions instead of calling tools — mark as incomplete, log for review (spec edge case SE3)
- [x] Handle edge case: timeout — record partial transcript, mark as timed out (spec edge case EC2)
- [x] Handle edge case: tool errors — log and continue conversation (Claude may self-correct) (spec edge case EC1)
- [x] System prompt: describe the 8 STRAP tools, derived from `client.listTools()`. Register tools as Anthropic API tool definitions with JSON Schema from MCP SDK
- **Spec**: mcp-eval-framework.md
- **Dependencies**: P0.2, P0.3
- **Files**: `evals/harness/runner.ts`, `evals/harness/claude-client.ts`

---

## P1 — Core (minimum viable eval system)

**Status: DONE**

### P1.1: State-check grader framework
- [x] Implement programmatic graders that validate project state after task completes
- [x] **Mock-tier graders** (transcript validation):
  - `tool-sequence`: Specific tools were called (order-independent, checks set membership)
  - `tool-params`: A specific tool call included expected parameters
  - `count`: Tool call count is within expected range
  - `no-errors`: No tool calls returned `isError: true`
- [x] **State graders** (MCP inspect validation):
  - `existence`: Call `component.list` or `inspect.node` to check an entity exists
  - `property`: Call `inspect.node` and check specific style/text/attr values
  - `structure`: Call `inspect.summary` and check child count, node types, nesting
  - `data`: Call `data.list-queries`, `interaction.list`, etc. to check data bindings
- [x] State graders work identically in mock and integration tier — they query the MCP server's current model state via tool calls
- [x] Handle extra output gracefully: if Claude creates extra nodes beyond what's asked, pass as long as required entities exist (spec edge case SE2)
- **Spec**: mcp-eval-grading.md (Tier 1)
- **Dependencies**: P0.4
- **Files**: `evals/graders/state-check.ts`, `evals/graders/transcript-check.ts`, `evals/graders/index.ts`

### P1.2: First 10 simple scenarios (one per domain + 2 cross-domain)
- [x] Write 10 YAML scenarios to validate the eval loop end-to-end:
  1. `project-list` — "List all projects" (project)
  2. `inspect-summary` — "Show me the structure of the [component]" (inspect; setup: project.set)
  3. `component-create-page` — "Create a page called About at /about" (component)
  4. `node-add-heading` — "Add a heading that says Hello World to [container]" (node)
  5. `variant-list` — "List all variants on [component]" (variant)
  6. `design-list-tokens` — "List all color tokens" (design)
  7. `data-list-queries` — "Show me what queries are defined on [component]" (data)
  8. `interaction-list` — "List event handlers on [element]" (interaction)
  9. `component-node-card` — "Create a card component with heading and description" (component + node)
  10. `node-design-style` — "Style the heading with 48px font size and blue color" (node + design)
- [x] Each scenario includes: id, description, domains, tier, graders, timeout, setup steps
- **Spec**: mcp-eval-scenarios.md (Simple tier)
- **Dependencies**: P0.4, P1.1
- **Files**: `evals/scenarios/project.yaml`, `evals/scenarios/inspect.yaml`, `evals/scenarios/component.yaml`, `evals/scenarios/node.yaml`, `evals/scenarios/variant.yaml`, `evals/scenarios/design.yaml`, `evals/scenarios/data.yaml`, `evals/scenarios/interaction.yaml`, `evals/scenarios/cross-domain.yaml`

### P1.3: JSON report output
- [x] After all scenarios run, produce structured JSON report
- [x] Handle partial results: if eval run is interrupted, save completed scenario results (spec edge case GE6)
- **Report schema**:
  ```typescript
  interface EvalReport {
    runId: string;                    // YYYY-MM-DD-HHMMSS
    timestamp: string;
    tier: "mock" | "integration";
    model: string;                    // Claude model used
    scenarios: ScenarioResult[];
    aggregate: {
      total: number;
      passed: number;
      failed: number;
      timedOut: number;
      successRate: number;            // 0-1
      meanToolCalls: number;
      meanDurationMs: number;
      meanTokensInput: number;
      meanTokensOutput: number;
      meanQualityScore: number | null; // null until LLM judge added (P2)
      byDomain: Record<string, { total: number; passed: number; successRate: number }>;
      byTier: Record<string, { total: number; passed: number; successRate: number }>;
    };
  }
  interface ScenarioResult {
    id: string;
    tier: string;
    domains: string[];
    success: boolean;
    qualityScore: number | null;      // null until LLM judge is added (P2)
    toolCalls: number;
    tokensInput: number;
    tokensOutput: number;
    durationMs: number;
    errors: string[];
    retries: number;
    transcript: TranscriptEntry[];    // Full conversation log
    graderResults: GraderResult[];    // Per-grader pass/fail with details
  }
  ```
- [x] Output: `evals/results/{runId}.json`
- **Spec**: mcp-eval-grading.md (Reporting)
- **Dependencies**: P0.4
- **Files**: `evals/harness/reporter.ts`

### P1.4: npm run eval command + CLI
- [x] Add `npm run eval` script to `packages/plasmic-mcp/package.json`: `"eval": "tsx evals/cli.ts"`
- [x] CLI flags:
  - `npm run eval` — Run all scenarios (mock tier by default)
  - `npm run eval -- --tier simple` — Filter by tier
  - `npm run eval -- --domain component` — Filter by domain
  - `npm run eval -- --scenario design-list-tokens` — Run single scenario
  - `npm run eval -- --integration` — Use integration tier (requires running Plasmic)
  - `npm run eval -- --no-visual` — Skip visual capture (default in mock tier)
  - `npm run eval -- --max-cost 5` — Abort if projected cost exceeds $N (default: $5)
- [x] CLI outputs summary table to stderr: scenario name, pass/fail, tool calls, duration
- [x] Exit code 0 if success rate >= threshold (default 90%), 1 otherwise
- [x] Fail fast with clear error if `ANTHROPIC_API_KEY` is not set
- **Spec**: mcp-eval-framework.md
- **Dependencies**: P0.4, P1.1, P1.2, P1.3
- **Files**: `evals/cli.ts`, `packages/plasmic-mcp/package.json` (scripts)

### P1.5: CI workflow for mock-tier evals
- [x] Add eval step to `.github/workflows/` (new `plasmic-mcp-eval.yml` or extend existing)
- [x] Runs on PRs touching `packages/plasmic-mcp/`
- [x] Requires `ANTHROPIC_API_KEY` secret (for Claude API calls during eval)
- [x] Runs `npm run eval -- --tier simple` first (fast feedback), then full mock tier
- [x] Posts summary as PR check annotation
- [x] Blocks merge if success rate < 90% (configurable via env var `EVAL_THRESHOLD`)
- [x] Cost controls: simple tier only on every PR, full suite nightly
- **Spec**: mcp-eval-framework.md (CI)
- **Dependencies**: P1.4
- **Files**: `.github/workflows/plasmic-mcp-eval.yml`

---

## P2 — Enhancement (richer eval coverage)

**Status: DONE (P2.1, P2.2, P2.3, P2.4, P2.5 done)**

### P2.1: Medium-complexity scenarios (~20) — DONE
- [x] 20 medium scenarios in `evals/scenarios/medium.yaml` covering all 8 STRAP domains.

### P2.2: Complex end-to-end scenarios (~15) — DONE
- [x] 15 complex scenarios in `evals/scenarios/complex.yaml` spanning 4-7 domains each.

### P2.3: Visual capture module (Playwright screenshots) — DONE
- [x] After each integration-tier task, capture a screenshot of Plasmic Studio showing the result
- [x] **Authentication**: Reuse pattern from `platform/wab/playwright/utils/api-client.ts`
  - CSRF → login → cookies. Env vars: `PLASMIC_STUDIO_EMAIL`, `PLASMIC_STUDIO_PASSWORD`, `PLASMIC_AUTH_HOST`
  - Auth once per eval run, reuse browser session across tasks
  - On auth failure: re-authenticate once, if still fails skip visual for remaining tasks (spec VE2)
- [x] **Navigation**: Reuse pattern from `platform/wab/playwright/utils/studio-utils.ts`
  - Call `inspect.preview-url` via MCP to get Studio URL
  - Navigate to `{host}/projects/{projectId}`
  - Wait for iframe chain: `page → iframe.studio-frame → iframe.__wab_studio-frame → .canvas-editor__canvas-container`
  - Navigation timeout: configurable, default 60 seconds (spec V9)
  - [x] If task modified a specific component, navigate to that component within Studio (spec V10). Runner extracts last componentUuid from transcript (tool input params + creation results) and passes to `capture()`, which appends `?arena_type=component&arena={uuid}` to the Studio URL. Falls back to project-level URL when no UUID available.
- [x] **Capture**: Full Studio editor view (tree + canvas + right panel), NOT just preview (spec V14)
  - Desktop: 1280x800 always captured
  - Mobile: 375x812 for responsive scenarios (keyword detection)
  - Save to `evals/results/screenshots/{runId}/{scenarioId}-{viewport}.png`
- [x] **Playwright config**: `actionTimeout: 10_000` via `context.setDefaultTimeout()` (V17), `trace` via `context.tracing.start()/stop()` — saves trace zip on capture failure for debugging (V18). `screenshot: "only-on-failure"` N/A — screenshots captured manually (V19).
- [x] **Edge cases**:
  - Studio fails to load: log timeout, save visible screenshot, mark visual failed, continue (spec VE1)
  - Studio shows spinner/error: screenshot captured anyway, flagged (spec V15/GE5)
  - Component deleted by task: navigate to project root (spec VE3)
  - [x] Multiple components modified: screenshot last modified (spec VE4). `extractLastComponentUuid()` returns the last UUID from the transcript, covering both input params and creation results.
  - Studio not running: skip visual with warning, state checks still run (spec VE5)
  - Browser crashes: relaunch, re-auth, continue from next task (spec VE6)
- [x] `--no-visual` flag skips this step (already existed, now wired up); Playwright dynamically imported so mock tier doesn't need it
- **Spec**: mcp-eval-visual-capture.md
- **Dependencies**: P1.4, running Plasmic Studio instance
- **Files**: `evals/visual/capture.ts`, `evals/visual/auth.ts`, `evals/harness/runner.ts` (extractLastComponentUuid), `src/__tests__/eval-visual-capture.test.ts` (22 tests)

### P2.4: LLM-as-Judge grading (Tier 2) — DONE
- [x] After visual capture, feed screenshot + transcript + rubric to multimodal Claude for quality scoring
- [x] Input: screenshot PNG(s), task prompt, full transcript, task-specific rubric
- [x] Model selection: Sonnet for simple/medium, Opus for complex (configurable via --judge-model)
- [x] Output: 1-5 quality score + text rationale
  - 5 = Exceptional (exceeds expectations)
  - 4 = Good (all requirements met, minor improvements possible)
  - 3 = Adequate (core requirements met, notable gaps)
  - 2 = Below expectations (partial completion)
  - 1 = Failed (wrong approach or significant errors)
- [x] Score is advisory (not used for CI pass/fail), stored in report alongside state-check results
- [x] Rubric defined per-scenario in YAML `visual.rubric` field
- [x] Fallback: if LLM judge API call fails, `qualityScore = null`, log warning, continue (spec GE3)
- [x] **Implementation**: `evals/graders/llm-judge.ts` — `runLlmJudge()` reads screenshot PNGs, sends multimodal message to Claude with task description + rubric + condensed transcript. Parses structured SCORE/RATIONALE response. Model selection: tier-based (Sonnet for simple/medium, Opus for complex), overridable via `--judge-model` CLI flag. Cost tracked separately in ScenarioResult and included in report totals. Judge disabled in mock tier (no screenshots) or with `--no-judge` flag.
- [x] Visual rubrics added to all 35 medium + complex scenarios in YAML.
- **Spec**: mcp-eval-grading.md (Tier 2)
- **Dependencies**: P2.3 (screenshots exist)
- **Files**: `evals/graders/llm-judge.ts`, `evals/harness/runner.ts` (JudgeConfig, wiring), `evals/harness/types.ts` (new fields), `evals/cli.ts` (--no-judge, --judge-model), `evals/harness/reporter.ts` (quality column), scenario YAMLs (rubrics)

### P2.5: Integration-tier MCP client (real Plasmic server) — DONE
- [x] Connect eval harness to a real running MCP server via stdio transport
- [x] Launch MCP server as child process: `npx tsx src/index.ts` via `StdioClientTransport`
- [x] Connect via `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`
- [x] Before each scenario, reset project via `project.set` (re-fetches from Plasmic API)
- [x] Env vars: `PLASMIC_AUTH_HOST`, `PLASMIC_AUTH_USER`, `PLASMIC_AUTH_TOKEN` (required); `EVAL_PROJECT_ID` (optional, or use `--project-id` CLI flag, or auto-detect via `project.list`)
- [x] CLI: `--project-id` flag, `--integration` flag, env var validation with early fail
- [x] Server stderr captured for debugging; exposed via `getServerStderr()`
- [x] Graceful cleanup: client.close() + transport.close() (kills child process)
- **Known limitation**: if a scenario calls `project.save`, changes persist in the remote project and become the new baseline for subsequent scenarios. True project cloning/reset requires Plasmic API calls outside MCP (future improvement).
- **Spec**: mcp-eval-framework.md (Integration tier)
- **Dependencies**: P1.4
- **Files**: `evals/harness/mcp-client.ts`, `evals/cli.ts`, `evals/harness/types.ts`

---

## P3 — Polish (quality-of-life improvements)

**Status: DONE**

### P3.1: Eval results dashboard — DONE
- [x] Static HTML page that reads JSON reports from `evals/results/` and shows trend lines
- [x] Metrics: success rate over time (overall + per-domain), quality score distribution, tool call efficiency, regression alerts, error rate by domain/action
- [x] Retention policy: retain last 90 days of results (spec GE7)
- [x] Single HTML file with inline Chart.js
- [x] Static HTML dashboard served by Node.js local server (`npm run eval:dashboard`). Chart.js from CDN. Visualizations: success rate trend (overall + per-domain), domain/tier bar charts, efficiency trends, token usage trends, regression alerts, error rate by domain, run history with expandable per-scenario details. Reports loaded via /api/reports endpoint with 90-day retention filter. Transcripts stripped from API response to reduce payload size.
- **Spec**: mcp-eval-grading.md (Dashboard)
- **Dependencies**: P1.3
- **Files**: `evals/dashboard/index.html`, `evals/dashboard/render.js`

### P3.2: Human review workflow (Tier 3) — DONE
- [x] Auto-flag criteria: state check and LLM judge disagree (`judge-disagrees`), LLM score <= 2 (`low-quality`), new/changed scenarios (`new-scenario`)
- [x] Report includes `needsReview: true` flag per scenario with `reviewFlags: string[]` reasons
- [x] `applyReviewFlags()` called during `generateReport()` using previous report for new-scenario detection
- [x] Dashboard surfaces review queue: flagged scenarios table with inline override form (override result, reviewer, notes)
- [x] Dashboard shows "Human Review Overrides" table for previously reviewed items
- [x] Mechanism: companion `evals/results/overrides.json` file for human annotations via `loadOverrides()`/`saveOverride()`
- [x] Dashboard server: `GET /api/overrides` and `POST /api/overrides` endpoints
- [x] CLI: `loadPreviousReport()` fetches latest report from results dir for new-scenario baseline
- [x] Reporter: `printSummary()` shows review queue count + flagged scenarios with flag reasons
- [x] Aggregate: `needsReview` count included in `EvalReport.aggregate`
- [x] **Implementation**: `evals/graders/review-flags.ts` — `computeReviewFlags()` (pure function per scenario) and `applyReviewFlags()` (batch mutator). Three flag types: `judge-disagrees` (state pass + judge <=2, or state fail + judge >=4), `low-quality` (judge <=2), `new-scenario` (ID not in previous report). Reporter calls `applyReviewFlags()` inside `generateReport()` before building aggregates. Overrides persisted in `evals/results/overrides.json` via `loadOverrides()`/`saveOverride()` functions. Dashboard renders review queue with inline forms; saves via POST to `/api/overrides`.
- [x] 24 unit tests in `src/__tests__/eval-review-flags.test.ts` covering all flag criteria (judge-disagrees, low-quality, new-scenario), combined flags, and `applyReviewFlags()` batch behavior.
- **Spec**: mcp-eval-grading.md (Tier 3)
- **Dependencies**: P2.4, P3.1
- **Files**: `evals/graders/review-flags.ts`, `evals/harness/types.ts` (ReviewOverride, OverridesFile, needsReview fields), `evals/harness/reporter.ts` (loadPreviousReport, loadOverrides, saveOverride, review summary), `evals/cli.ts` (loadPreviousReport wiring), `evals/dashboard/index.html` (review queue + overrides UI), `evals/dashboard/render.js` (overrides API endpoints), `src/__tests__/eval-review-flags.test.ts`

### P3.3: Remaining simple scenarios (fill to ~20 total) — DONE
- [x] 10 new simple scenarios added in `evals/scenarios/simple-extra.yaml`. Total: 20 simple. Covers: upload-asset, rename-token, create-mixin, create-animation, create-screen-variant, update-page-meta, extract-to-component, undo, dry-run mode (node), create-token.

### P3.4: Scenario index and validation — DONE
- [x] Standalone validator in `evals/harness/scenario-validator.ts`. Validates unique IDs, valid domains, valid grader types, setup step validity, grader params, tier targets. `npm run eval:validate` script added.

### P3.5: Cost tracking and rate limiting — DONE
- [x] Model-aware pricing (Sonnet/Haiku/Opus per-million-token rates). `totalCostDollars` in `EvalReport.aggregate`. Cost shown in summary output. `runAll()` returns `RunAllResult` with `totalCostDollars`.

---

## Spec Gap Analysis

The following gaps were identified between specs and this plan. Items above already incorporate these fixes; this section is for traceability.

### Deliberate Deviations from Specs (documented decisions)
1. **Custom harness over Promptfoo** — Spec says "Promptfoo configured"; plan uses custom Anthropic SDK harness. Reasons in Design Decisions below.
2. **Mock tier as MVP** — Spec presents tiers as co-equal; plan prioritizes mock (P0/P1) and defers integration (P2).
3. **Setup steps** — Not in specs; added for test reliability (deterministic preconditions).

### Gaps Addressed in This Plan Update
| Gap | Spec Source | Resolution |
|-----|-------------|------------|
| Missing API key fail-fast | EC4 | Added to P0.2 and P1.4 |
| Ungraded scenario handling | EC6 | Added to P0.3 (warn, track, don't affect pass rate) |
| Claude asks clarifying questions | SE3 | Added to P0.4 (mark incomplete, log) |
| Timeout partial transcript | EC2 | Added to P0.4 |
| Tool error continuation | EC1 | Added to P0.4 |
| Extra output tolerance | SE2 | Added to P1.1 |
| Interrupted run partial save | GE6 | Added to P1.3 |
| `meanQualityScore` in aggregate | R2 | Added to P1.3 schema |
| Scenario count shortfall | S3 | Bumped P2.1 to ~20, P2.2 to ~15 (total ~55) |
| Visual capture edge cases (6) | VE1-VE6 | Added to P2.3 |
| Navigation timeout default | V9 | Added to P2.3 (60s configurable) |
| Component-level navigation | V10 | Added to P2.3 |
| Full editor view clarification | V14 | Added to P2.3 |
| Playwright config details | V17-V19 | Added to P2.3 |
| LLM judge fallback on API error | GE3 | Added to P2.4 |
| Quality score rubric definition | G16 | Added to P2.4 (5-level scale) |
| Error rate by domain in dashboard | R3 | Added to P3.1 |
| Dashboard retention policy | GE7 | Added to P3.1 (90 days) |

### Scenario Count Targets (spec: 50-80 total)
| Tier | Spec Target | Implemented | Remaining | Plan Item |
|------|-------------|-------------|-----------|-----------|
| Simple | ~20 | **20 (P1.2 + P3.3)** | 0 | P1.2 + P3.3 ✓ |
| Medium | ~20 | **20 (P2.1)** | 0 | P2.1 ✓ |
| Complex | ~15-20 | **15 (P2.2)** | 0-5 | P2.2 ✓ |
| **Total** | **50-80** | **55** | **0** | |

---

## Design Decisions Log

### Custom harness over Promptfoo
**Decision**: Build a custom eval harness using the Anthropic SDK directly instead of adopting Promptfoo.
**Rationale**:
- Our evals are multi-turn tool-use conversations, not single-turn prompt-response pairs. Promptfoo's model assumes prompt → response → grade, but MCP tool use requires an agentic loop (Claude calls tools, gets results, calls more tools, eventually responds).
- Mock tier requires in-process MCP server via InMemoryTransport. Promptfoo would need a custom provider that essentially IS our harness.
- We need tight control over transcript capture, tool routing, and timeout handling.
- The custom harness is ~300-500 lines. The Promptfoo adapter to achieve the same would be comparable complexity plus Promptfoo's overhead.
- If Promptfoo adds native multi-turn MCP support, we can wrap our runner as a Promptfoo provider (20-line adapter).

### Mock tier as MVP
**Decision**: Mock tier (in-process server with WAB mocks) is the entire P0/P1. Integration tier is P2.
**Rationale**:
- Mock tier runs fast (~seconds per scenario vs ~minutes for integration), needs no infrastructure, and validates the critical question: "does Claude select the right tools with the right parameters?"
- The existing 1197 tests already prove the tools themselves work correctly. Evals test Claude's ability to USE the tools, not the tools' correctness.
- Integration tier adds value (validates full roundtrip including model loading, saving, visual output) but is expensive and requires a running Plasmic instance.

### Scenario setup steps
**Decision**: Scenarios can include `setup` steps that are direct tool calls (not mediated by Claude).
**Rationale**:
- Many scenarios need preconditions (e.g., "a project is loaded", "a component called Hero exists"). Running these through Claude would be slow, expensive, and fragile.
- Setup steps are deterministic — they call MCP tools directly with known parameters. Only the main task prompt goes through Claude.
- This mirrors how unit tests use `beforeEach` to set up fixtures.

### Tool definition extraction via listTools()
**Decision**: Use `client.listTools()` from the MCP SDK to get tool schemas as JSON Schema, then convert to Anthropic API tool format.
**Rationale**:
- Avoids duplicating Zod schemas. The MCP SDK automatically converts Zod → JSON Schema.
- Tool definitions stay in sync with the server automatically — no manual maintenance.
- The `McpServer` class has no public API to enumerate tools directly; `Client.listTools()` via InMemoryTransport is the canonical approach.

---

## Implementation Order (Critical Path)

```
P0.1 (scaffolding)
  |
  +-- P0.2 (MCP client adapter)
  |     |
  |     +-- P0.4 (eval runner) -------> P1.1 (graders) -> P1.2 (10 scenarios)
  |                                                              |
  P0.3 (scenario schema) ----+                                  v
                                                           P1.3 (reports)
                                                               |
                                                               v
                                                           P1.4 (CLI + npm run eval)
                                                               |
                                                               v
                                                           P1.5 (CI workflow)
                                                               |
                                +------+------+------+-----+
                                v      v      v      v
                              P2.1   P2.3   P2.5   P3.*
                                |      |
                                v      v
                              P2.2   P2.4
```

**ALL PHASES COMPLETE.** P0 + P1: working `npm run eval` with mock-tier state-check grading, JSON reports, CI workflow. P2: 55 scenarios (20 simple + 20 medium + 15 complex), visual capture with component-level navigation (V10/VE4), LLM-as-Judge, integration-tier MCP client. P3: eval dashboard, human review workflow with auto-flagging (judge-disagrees, low-quality, new-scenario) and overrides.json persistence, scenario validator, cost tracking. 1243 tests passing (1106 unit + 137 integration).
