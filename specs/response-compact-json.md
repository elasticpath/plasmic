# Compact JSON Responses

## Jobs to Be Done
- As an LLM agent consuming MCP responses, I want compact JSON so that responses use fewer tokens and leave more context window for reasoning
- As a developer, I want consistent serialization so that response sizes are predictable

## Background

The server has **154 `JSON.stringify` calls**. 14 of them use pretty-printing (`null, 2`), adding 30-40% token overhead per response. The worst offenders are the `inspect.tree` and `inspect.summary` handlers — the most frequently called tools — which pretty-print full component trees.

Example: a 10 KB tree becomes ~13-14 KB with pretty-printing. For a 50-node component summary, that's ~3-4k wasted tokens per call.

## Implementation

### 1. Remove all `JSON.stringify(x, null, 2)` calls in server.ts

Replace every `JSON.stringify(result, null, 2)` with `JSON.stringify(result)` across the entire server.ts file. All 14 instances.

### 2. Keep pretty-printing ONLY for file writes

The `export` action writes to a temp file for human reading — that one can stay pretty-printed since it doesn't go through the context window.

### 3. Compact key names (optional, high-impact)

For the tree-reader output, consider shorter keys on the TreeNode:
- `childCount` → `cc` (saves 8 bytes per node × 50 nodes = 400 bytes)
- `componentName` → `comp` (saves 9 bytes per component instance)
- `componentUuid` → `compId` (saves 9 bytes)
- `layoutType` → `layout` (saves 4 bytes)
- `visibility` → `vis` (saves 7 bytes)

This is lower priority than removing pretty-printing but compounds across large trees.

## Acceptance Criteria
- [ ] Zero `JSON.stringify(x, null, 2)` calls in server.ts except for file-write paths (export action)
- [ ] All MCP tool responses use compact JSON (no indentation, no extra whitespace)
- [ ] `export` action still writes pretty-printed JSON to temp file
- [ ] Response sizes measured: tree/summary for a 50-node component should be 30-40% smaller than before
- [ ] All existing tests pass (response parsing is JSON.parse which handles both formats)
- [ ] Integration tests verify compact output

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Agent tries to read compact JSON | LLMs parse compact JSON fine — they don't need pretty-printing |
| File export action | Keep pretty-printed for human readability |
| Error responses | Also compact — no pretty-printing on error JSON |

## Out of Scope
- Response compression (gzip) — MCP protocol doesn't support it natively
- Shorter key names (deferred — needs tree-reader + test updates)
