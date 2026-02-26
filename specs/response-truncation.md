# Response Truncation with Continuation Hints

## Jobs to Be Done
- As an LLM agent, I want responses that never exceed my token budget so that my context window doesn't fill up from a single tool call
- As a developer, I want a safety net that prevents any single response from consuming excessive context regardless of component size

## Background

Claude Code enforces a 25,000-token limit on tool responses. Even with compact JSON and maxDepth defaults, a component with 200+ nodes at depth 3 could still produce 15-20k tokens. A hard truncation with a continuation hint ensures no single response is catastrophically large.

## Implementation

### 1. Add character budget to tree serialization

After serializing the tree JSON, check the character count. If it exceeds a threshold (default: 15,000 characters ≈ 4,000 tokens), truncate the tree and append a continuation hint.

### 2. Truncation strategy

- Serialize the tree depth-first
- When the accumulated output exceeds the budget, stop adding nodes
- Replace remaining children with `"... N more nodes. Use inspect.subtree to drill in."`
- Set `truncated: true` on the response

### 3. Configurable budget

Add optional `maxChars` parameter to inspect actions:
```
inspect({ action: "tree", maxChars: 10000 })
```

Default: 15,000 characters. Can be set lower for context-constrained agents.

### 4. Truncation output format

```json
{
  "name": "ProductPage",
  "truncated": true,
  "nodesShown": 35,
  "totalNodes": 87,
  "hint": "Response truncated at 15000 chars. Use inspect.subtree with a nodeRef to see deeper sections, or pass maxDepth to limit tree depth.",
  "tree": { ... partial tree ... }
}
```

## Acceptance Criteria
- [ ] Responses over 15,000 characters are truncated with continuation hint
- [ ] `truncated: true` and `nodesShown`/`totalNodes` fields present when truncated
- [ ] Hint message guides agent to use subtree/maxDepth
- [ ] `maxChars` parameter allows agent to request smaller responses
- [ ] Truncation preserves valid JSON (no mid-object cuts)
- [ ] Higher-level nodes are preserved over deeper nodes (breadth-first priority)
- [ ] Unit tests for truncation at various budgets
- [ ] Integration test: large component triggers truncation, agent follows hint to drill in

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Response under budget | No truncation, `truncated: false` or field omitted |
| maxChars: 500 | Returns just root + truncation hint |
| maxChars: -1 | Unlimited (no truncation) |
| Component with 1 node | Never truncated |
| Truncation mid-children | Show first N children, append `"... M more"` message |

## Out of Scope
- Streaming responses (MCP SDK doesn't support streaming tool results yet)
- Token-based budget (character count is a good proxy: ~4 chars per token)
- Pagination with offset/cursor (truncation with hints is simpler and sufficient for tree structures)
