# Default maxDepth on Summary and Tree Actions

## Jobs to Be Done
- As an LLM agent, I want bounded response sizes by default so that inspecting a component doesn't blow up my context window
- As a skill author, I want sensible defaults so that agents don't need to remember to pass maxDepth every time

## Background

Currently `maxDepth` defaults to **unlimited** — omitting it returns the ENTIRE tree recursively. A deeply nested 500-node component returns all 500 nodes. The summary action was designed to be lightweight but still returns full depth.

The progressive disclosure pattern says: start shallow, drill down. The server should enforce this by default.

## Implementation

### 1. Default `maxDepth: 2` on `inspect.summary` action

When `maxDepth` is not provided, default to 2 (root → children → grandchildren). Nodes beyond depth 2 are represented only by `childCount`.

### 2. Default `maxDepth: 3` on `inspect.tree` action

When `maxDepth` is not provided, default to 3. This gives enough context for most editing tasks while bounding response size.

### 3. No default limit on `inspect.subtree` and `inspect.node`

These are targeted drill-down tools — the agent is already being specific. Keep unlimited depth.

### 4. Add `maxDepth: -1` to mean "unlimited"

If the agent explicitly needs the full tree (rare), it can pass `maxDepth: -1` to override the default.

### 5. Include truncation hint in response

When maxDepth truncates the tree, add a top-level field:
```json
{
  "name": "ProductPage",
  "truncated": true,
  "maxDepthApplied": 2,
  "totalNodes": 87,
  "hint": "Use inspect.subtree or inspect.node to drill into specific sections",
  "tree": { ... }
}
```

## Acceptance Criteria
- [ ] `inspect({ action: "summary" })` without maxDepth returns depth-2 tree
- [ ] `inspect({ action: "tree" })` without maxDepth returns depth-3 tree
- [ ] `inspect({ action: "summary", maxDepth: -1 })` returns full unlimited tree
- [ ] `inspect({ action: "subtree" })` still defaults to unlimited depth
- [ ] Response includes `truncated: true` and `hint` when maxDepth truncates
- [ ] Response includes `totalNodes` count for orientation
- [ ] Existing tests updated to pass explicit maxDepth where they need full depth
- [ ] Integration tests verify truncation hint appears

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Component has < maxDepth levels | `truncated: false`, no hint |
| maxDepth: 0 | Only root node |
| maxDepth: -1 | Unlimited (explicit override) |
| maxDepth: 100 on shallow component | Returns full tree, `truncated: false` |

## Out of Scope
- Node-count-based truncation (e.g., "max 50 nodes") — depth-based is simpler and more predictable
- Streaming/chunked responses
