# Implementation Plan

Goal: Claude Code skills and workflows that create Plasmic pages programmatically from the terminal.

## Current State

- **MCP server**: 8 STRAP domain tools, ~103 actions, ~4,900-line server.ts
- **Skills**: 6 Claude Code skills (plasmic, plasmic-inspect, plasmic-edit, plasmic-create-page, plasmic-create-component, plasmic-patterns)
- **Tests**: 1,180 passing (1046 unit + 134 integration), 0 skipped, 0 TODOs in code
- **Code quality**: Zero FIXMEs, zero HACK/XXX markers, zero placeholders, zero partial implementations
- **Core page-creation workflow**: Functional end-to-end (project.set -> discover tokens -> build tree -> create-page -> enhance via /plasmic-edit -> save)

All priorities (P1-P6) are DONE. All spec acceptance criteria are met.

---

## Post-P6 Cleanup (completed)

- **Fixed `project.set` pretty-print**: Last remaining `JSON.stringify(x, null, 2)` in a non-file-write path. Changed to compact format to satisfy `response-compact-json.md` spec acceptance criterion: "Zero `JSON.stringify(x, null, 2)` calls in server.ts except for file-write paths."
- **Fixed spec inconsistency**: `response-truncation.md` used `nodesTotal` while `response-default-maxdepth.md`, all code, all tests, and skills use `totalNodes`. Updated the spec to match.

---

## Post-P6 Gap Audit (completed)

Thorough verification of all 6 specs against implementation revealed and resolved:

### P4 bug fix: inspect.subtree char-truncation missing nodesShown/totalNodes
The subtree handler only set `truncated: true` and `hint` when char-truncated, but omitted `nodesShown` and `totalNodes` — unlike the tree/summary handlers which include both. Fixed by tracking `totalNodes` before truncation and including `nodesShown`/`totalNodes` in the subtree response.

### P4 test gap: subtree truncation unit + integration tests
Added 4 unit tests: default maxChars 15000, custom maxChars, maxChars: -1 unlimited, char truncation metadata (nodesShown, totalNodes, hint). Added 2 integration tests: subtree totalNodes verification, subtree char-budget truncation with metadata.

### P4 test gap: truncation drill-in workflow
Added integration test that simulates the agent workflow: receive truncated tree → follow hint → drill in with inspect.subtree.

### P2 test gap: compact JSON verification
Added integration test that verifies MCP responses use compact JSON (no indentation patterns) and remain valid JSON.

### P6 test gap: concise drill-in by child name
Added integration test: concise summary → find named child → drill in with inspect.node using child name.

### P5 skill gaps: format:concise and truncation hints
Updated 3 skills:
- **plasmic-edit.md**: Added `format: "concise"` to summary calls, added truncation hint guidance
- **plasmic-create-page.md**: Added `format: "concise"` to summary call, added truncation hint guidance
- **plasmic-create-component.md**: Added `format: "concise"` to all summary calls, added truncation hint guidance

---

## Execution Order

```
P1 (component instance styling)  -- DONE
P2 (compact JSON)                -- DONE (post-cleanup: project.set compact fix; post-audit: compact JSON integration test)
P3 (default maxDepth)            -- DONE
P4 (response truncation)         -- DONE (post-audit: subtree nodesShown/totalNodes fix + 6 new tests + drill-in workflow test)
P5 (skills progressive nav)      -- DONE (post-audit: format:concise + truncation hints in 3 skills)
P6 (concise format)              -- DONE (post-audit: concise drill-in by child name integration test)
```

All priorities complete. All spec acceptance criteria verified and met.
