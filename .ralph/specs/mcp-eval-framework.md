# MCP Eval Framework

## Jobs to Be Done
- As an MCP developer, I want to run a suite of eval tasks against our MCP server so that I can measure whether Claude can reliably complete Plasmic design/development tasks using our tools.
- As an MCP developer, I want evals to run in CI on PRs that touch `packages/plasmic-mcp/` so that regressions are caught before merge.

## Acceptance Criteria
- [x] ~~Promptfoo is configured as the eval framework~~ → Custom multi-turn eval harness built with Anthropic SDK (see Design Decision below). Promptfoo's single-turn model doesn't support multi-turn tool-use conversations.
- [x] `npm run eval` in `packages/plasmic-mcp/` executes the full eval suite and outputs a summary (pass/fail per task, aggregate success rate, metrics)
- [x] Two execution tiers exist:
  - **Mock tier**: Uses existing Vitest WAB mocks. Fast, runs in CI on every PR. Validates tool selection and parameter correctness without hitting real APIs.
  - **Integration tier**: Connects to a dedicated Plasmic test project. Validates end-to-end task completion against real project state. Runs nightly or on-demand.
- [x] CI workflow (GitHub Actions) runs simple-tier evals on PRs touching `packages/plasmic-mcp/` and blocks merge if success rate drops below a configurable threshold (default: 90%). Full mock tier runs nightly.
- [x] Eval results are persisted to a dashboard showing trends over time (success rates, efficiency metrics, error patterns). Dashboard served via `npm run eval:dashboard`.
- [x] Each eval run produces a structured JSON report with per-task results, metrics, and transcripts

## Happy Path
1. Developer modifies a tool schema or skill prompt in `packages/plasmic-mcp/`
2. Developer runs `npm run eval` locally to validate changes
3. Promptfoo executes all task scenarios, routing each through the MCP server
4. For each task: Claude receives the prompt, calls MCP tools, produces a result
5. Graders run against the result (state checks + LLM judge)
6. CLI outputs a summary table: task name, pass/fail, tool calls, tokens, time
7. Developer pushes and creates a PR
8. CI runs mock-tier evals automatically
9. If success rate >= threshold, PR is green; otherwise, CI fails with a report of which tasks regressed
10. Dashboard updates with the new data point, showing trend lines

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Claude hits MCP tool error | Log the error, mark task as failed, continue to next task |
| Claude times out (no completion in N seconds) | Mark task as timed out / failed, record partial transcript |
| LLM judge disagrees with state check | Both grades are recorded; state check is authoritative for pass/fail, LLM judge is advisory |
| Promptfoo API key missing | Eval run fails fast with clear error message listing required env vars |
| Test Plasmic project is in unexpected state | Integration tier resets project to known state before each task (or skips with warning) |
| New task scenario added but no grader defined | Eval run warns about ungraded tasks; they are tracked but don't affect pass rate |

## Design Decisions
- **Custom harness over Promptfoo**: Our evals are multi-turn tool-use conversations, not single-turn prompt-response pairs. Promptfoo's model assumes prompt → response → grade, but MCP tool use requires an agentic loop (Claude calls tools, gets results, calls more tools, eventually responds). The custom harness is ~500 lines; a Promptfoo adapter would be comparable complexity plus Promptfoo's overhead.

## Out of Scope
- Production telemetry / observability instrumentation of the live MCP server
- External benchmarking (MCP-Bench, BFCL leaderboard comparisons)
- Eval scenarios for non-Claude LLMs (we only test with Claude)
- Automated skill prompt optimization (evals inform manual tuning only)
