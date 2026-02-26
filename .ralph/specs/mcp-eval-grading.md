# MCP Eval Grading & Reporting

## Jobs to Be Done
- As an MCP developer, I want a three-tier grading system so that I can objectively measure task success with both deterministic checks and quality assessment.
- As an MCP developer, I want a dashboard showing eval trends over time so that I can track whether our MCP server is improving or regressing.

## Acceptance Criteria

### Tier 1: State Checks (Programmatic)
- [ ] After each eval task completes, programmatic graders validate the resulting project state
- [ ] State checks are deterministic and fast (no LLM calls)
- [ ] State check types include:
  - **Existence**: Component/page/node/variant/token exists with expected name
  - **Property**: Node has expected styles, text, attributes, visibility
  - **Structure**: Component has expected child count, nesting depth, node types
  - **Data**: Data bindings, queries, interactions are configured correctly
  - **Count**: Expected number of tool calls made, within acceptable range
- [ ] State checks are the authoritative source for pass/fail determination
- [ ] For mock-tier evals, state checks validate the tool call sequence and parameters (since no real project state exists)
- [ ] For integration-tier evals, state checks query the actual Plasmic project via `inspect` tools

### Tier 2: Visual LLM-as-Judge (Quality)
- [ ] After each task completes, Playwright captures a screenshot of the Plasmic Studio editor view showing the component tree, design surface, and panel state
- [ ] Screenshots are captured at desktop (1280x800) breakpoint; for responsive scenarios, also at mobile (375x812)
- [ ] The screenshot(s) plus the task prompt and transcript are fed to a multimodal LLM judge
- [ ] Judge model is tiered by scenario complexity:
  - **Simple/Medium tasks**: Claude Sonnet (fast, cost-effective)
  - **Complex tasks**: Claude Opus (highest quality visual assessment)
- [ ] Rubrics are task-specific, defined alongside each scenario, with 1-5 scoring scale:
  - 5: Exceeds expectations — visually well-structured, good hierarchy, appropriate spacing/sizing, clean naming in tree
  - 4: Meets expectations — all visual requirements met, reasonable layout and structure
  - 3: Acceptable — requirements met but with minor visual issues (poor spacing, inconsistent sizing, awkward nesting)
  - 2: Partial — some requirements met, significant visual or structural issues
  - 1: Failed — result does not visually match the intent despite state checks passing
- [ ] LLM judge scores are advisory (not used for CI pass/fail) but tracked in dashboard
- [ ] Judge provides a brief rationale with each score for human review
- [ ] Screenshots are saved alongside the eval report for archival and human spot-check

### Tier 3: Human Spot-Check
- [ ] Eval reports include full transcripts (prompts, tool calls, responses) for human review
- [ ] A mechanism exists to flag specific tasks for human review (e.g., tasks where state check and LLM judge disagree, or new/changed scenarios)
- [ ] Human reviewers can annotate transcripts with notes and override grades
- [ ] Dashboard surfaces tasks most in need of human review (disagreements, low LLM scores, new scenarios)

### Metrics Tracked Per Task
- [ ] `success`: boolean (from state checks)
- [ ] `quality_score`: 1-5 (from LLM judge)
- [ ] `tool_calls`: number of MCP tool invocations
- [ ] `tokens_input`: total input tokens consumed
- [ ] `tokens_output`: total output tokens consumed
- [ ] `duration_ms`: wall-clock time from prompt to completion
- [ ] `errors`: count and types of tool errors encountered
- [ ] `retries`: number of error recovery attempts by Claude

### Reporting & Dashboard
- [ ] Each eval run produces a JSON report with all per-task results and aggregate metrics
- [ ] Aggregate metrics per run: overall success rate, mean quality score, mean tool calls, mean tokens, mean duration, by tier and domain
- [ ] Dashboard shows:
  - Success rate trend line over time (overall and per-domain)
  - Quality score distribution
  - Efficiency trends (tool calls, tokens per task)
  - Error rate by domain/action
  - Regression alerts (tasks that previously passed but now fail)
- [ ] Dashboard is accessible via a web UI (Promptfoo's built-in viewer, or a custom static page)

## Happy Path
1. Eval run completes all tasks
2. State checks run immediately after each task — pass/fail determined
3. Playwright opens Plasmic Studio, navigates to the edited component/page, and captures a screenshot of the editor view
4. Screenshot(s) + prompt + transcript are sent to the multimodal LLM judge (Sonnet or Opus based on task tier)
5. LLM judge returns a 1-5 quality score with rationale
6. JSON report written to `evals/results/YYYY-MM-DD-HHMMSS.json` with screenshots saved to `evals/results/screenshots/`
7. Dashboard ingests the report and updates trend lines
8. Developer reviews summary: "45/50 tasks passed, avg quality 4.2, avg 5.3 tool calls"
9. Developer drills into failures, viewing screenshots and transcripts side-by-side
10. CI reports the same summary as a PR check annotation

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| State check passes but LLM judge gives score 1-2 | Task is marked as passed (state check authoritative) but flagged for human review |
| State check fails but Claude's output is actually reasonable | Task fails; human reviewer can override and the scenario grader should be updated |
| LLM judge is unavailable (API error) | Task still passes/fails based on state checks; quality score recorded as null |
| Plasmic Studio fails to load in Playwright | Screenshot step skipped; quality score recorded as null; task flagged for manual review |
| Studio shows a loading spinner or error state | Screenshot is captured anyway; LLM judge notes the issue in rationale; task flagged |
| Eval run interrupted mid-suite | Partial results are saved; re-run skips completed tasks or starts fresh (configurable) |
| Dashboard storage fills up | Retain last 90 days of results; older results archived or purged |

## Out of Scope
- Real-time alerting (Slack/email notifications on regression)
- Automated prompt optimization based on eval results
- A/B testing of different skill prompt versions (manual comparison only)
- Cost tracking / billing integration (token counts are tracked but not priced)
