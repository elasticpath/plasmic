# Implementation Plan

Goal: Claude Code skills and workflows that create Plasmic pages programmatically from the terminal.

## Current State

- **MCP server**: 8 STRAP domain tools, ~103 actions, ~4,650-line server.ts
- **Skills**: 6 Claude Code skills (plasmic, plasmic-inspect, plasmic-edit, plasmic-create-page, plasmic-create-component, plasmic-patterns)
- **Tests**: 1,184 passing (1047 unit + 137 integration), 0 skipped, 0 TODOs in code
- **Code quality**: Zero FIXMEs, zero HACK/XXX markers, zero placeholders, zero partial implementations
- **Core page-creation workflow**: Functional end-to-end (project.set -> discover tokens -> build tree -> create-page -> enhance via /plasmic-edit -> save)

All priorities (P1-P6) are DONE. All spec acceptance criteria are met.

---

## Post-P6 Comprehensive Audit (completed)

### P2 critical fix: compact JSON for all domains (134 remaining pretty-print calls)

Full audit revealed the original P2 fix only converted ~6 inspect handlers to compact JSON. The remaining **134 `JSON.stringify(x, null, 2)` calls** across project, component, node, variant, design, data, and interaction domains were still pretty-printing. All 134 converted to `JSON.stringify(x)` — only the `inspect.export` file-write path retains `null, 2`. This satisfies the `response-compact-json.md` acceptance criterion: "Zero `JSON.stringify(x, null, 2)` calls in server.ts except for file-write paths."

### Error handling fixes

1. **`withDryRun` rollback logging**: Added `console.error` CRITICAL message when dry-run rollback fails (was silently swallowed with `catch (_) {}`).
2. **`component.create-page/create/clone` batch safety**: Added these 3 mutation actions to the `handleMutationError` allowlist so batch is properly cancelled and changes rolled back on failure.
3. **`design` list-action error format**: Changed `"Error: ${err.message}"` to `"Error in design.${action}: ${err.message}"` for consistency with the STRAP `"Error in domain.action: message"` pattern.

### Test gap fills (4 new tests)

1. **Non-inspect compact JSON**: Integration test verifying component.list, variant.list, and design.list-tokens responses use compact JSON.
2. **Error response compactness**: Integration test verifying error responses don't contain indentation patterns.
3. **maxDepth: 100 on shallow component**: Integration test confirming `truncated: false` when maxDepth vastly exceeds component depth.
4. **Unnamed node concise format**: Unit test verifying unnamed nodes retain `tag` for identification when UUIDs are stripped.

---

## Execution Order

```
P1 (component instance styling)  -- DONE
P2 (compact JSON)                -- DONE (post-audit: 134 remaining pretty-print calls fixed + 2 new integration tests)
P3 (default maxDepth)            -- DONE (post-audit: maxDepth:100 edge case test)
P4 (response truncation)         -- DONE
P5 (skills progressive nav)      -- DONE
P6 (concise format)              -- DONE (post-audit: unnamed node identification test)
```

All priorities complete. All spec acceptance criteria verified and met.
