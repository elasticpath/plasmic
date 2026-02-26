# Concise Response Format

## Jobs to Be Done
- As an LLM agent navigating a component tree, I want a concise output mode that strips non-essential fields so that I can orient quickly without burning tokens on UUIDs I won't use
- As a skill author, I want to control response verbosity so that different workflows (browsing vs editing) get appropriately sized responses

## Background

The MCP tool guidance recommends a `response_format` parameter with "concise" vs "detailed" modes. The Slack MCP server achieved 65% token reduction using this pattern.

Currently every node in summary mode includes `uuid` (36 bytes), `type`, `tag`, `name`, `childCount`, plus optional `visibility`/`dataCond`/`dataRep`. UUIDs are only needed when the agent wants to target a node for mutation — pure browsing/orientation doesn't need them.

## Implementation

### Add `format` parameter to inspect actions

```
inspect({ action: "summary", format: "concise" | "full" })
```

- **`full`** (default): Current behavior — includes all fields including UUIDs
- **`concise`**: Strips UUIDs from all nodes except the root. Strips `dataRep` details (just shows `"repeats": true`). Strips `dataCond` expression (just shows `"conditional": true`). Produces a minimal orientation view.

### Concise node format

Full mode:
```json
{"type":"tag","tag":"div","uuid":"abc123","name":"Hero Section","childCount":5,"visibility":"notRendered","dataCond":"$ctx.isLoggedIn","dataRep":{"collection":"$queries.items.data","elementVariable":"currentItem"}}
```

Concise mode:
```json
{"tag":"div","name":"Hero Section","cc":5,"hidden":true,"conditional":true,"repeats":true}
```

Key reductions:
- Drop `type` field (can be inferred from tag/componentName/slotName presence)
- Drop `uuid` (not needed for orientation)
- Drop `nodeType` (rarely useful)
- `childCount` → `cc`
- `visibility` → `hidden: true`
- `dataCond` expression → `conditional: true`
- `dataRep` object → `repeats: true`

### Estimated savings

For a 50-node component summary:
- Full mode: ~150-200 bytes/node = ~8-10 KB
- Concise mode: ~40-60 bytes/node = ~2-3 KB
- **~70% reduction**

## Acceptance Criteria
- [ ] `inspect({ action: "summary", format: "concise" })` returns compact output
- [ ] `inspect({ action: "tree", format: "concise" })` returns compact output
- [ ] Root node always includes UUID (needed for subsequent calls)
- [ ] `format: "full"` is the default (backward compatible)
- [ ] Concise format for 50-node component is under 3 KB
- [ ] Agent can still identify nodes by name or position for follow-up calls
- [ ] Unit tests for concise formatting
- [ ] Integration test: concise summary → identify node by name → drill in with inspect.node

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Node has no name | Include tag and index position for identification |
| Component instance in concise mode | Show `comp: "CardComponent"` instead of `componentName` + `componentUuid` |
| Slot node in concise mode | Show `slot: "children"` |
| format parameter on non-inspect tools | Ignored (only affects inspect domain) |

## Out of Scope
- Per-field selection (GraphQL-style "return only these fields")
- Custom format templates
