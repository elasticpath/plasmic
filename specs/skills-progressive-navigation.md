# Skills: Progressive Navigation Pattern

## Jobs to Be Done
- As an LLM agent following a skill, I want clear instructions on how to navigate component trees efficiently so that I don't waste context on full tree dumps
- As a skill author, I want skills that teach the progressive disclosure pattern so that agents naturally make small, targeted inspect calls

## Background

The current skills don't explicitly guide agents to use progressive navigation. Agents default to calling `inspect({ action: "summary" })` or `inspect({ action: "tree" })` without maxDepth, getting massive responses. The server-side fixes (compact JSON, default maxDepth, truncation) are safety nets — the skills should teach the RIGHT pattern so agents rarely hit those limits.

The progressive disclosure pattern for tree navigation:
1. **Orient**: `inspect.summary` (depth 2, concise) — "what's the overall structure?"
2. **Locate**: `inspect.node` (single node by name) — "show me this specific section"
3. **Detail**: `inspect.subtree` (targeted branch) — "expand this subtree"
4. **Full**: `inspect.tree` (with maxDepth/format) — only when truly needed for restructuring

## Implementation

### 1. Update `plasmic-inspect.md` skill

Add explicit progressive navigation instructions:

```markdown
## Navigation Pattern

ALWAYS navigate progressively. NEVER request the full tree.

Step 1 — Orient: Get the component outline
  inspect({ action: "summary", format: "concise", maxDepth: 2 })

Step 2 — Locate: Find the node you need by name
  inspect({ action: "node", nodeRef: "Hero Section" })

Step 3 — Drill: Expand a specific subtree if needed
  inspect({ action: "subtree", nodeRef: "Card Grid", maxDepth: 2 })

AVOID:
- inspect({ action: "tree" }) without maxDepth — returns too much data
- inspect({ action: "summary" }) on components with 50+ nodes without format: "concise"
```

### 2. Update `plasmic-edit.md` skill

When editing, the agent should:
1. Inspect only the target node (not the whole tree)
2. After mutations, verify with targeted reads (not full tree re-reads)

```markdown
## After Editing

DO: inspect({ action: "node", nodeRef: "the-node-you-edited" })
DON'T: inspect({ action: "tree" })  — wasteful full re-read
```

### 3. Update `plasmic-create-page.md` and `plasmic-create-component.md`

After creation, verify with summary (depth 1-2), not full tree.

### 4. Update `plasmic.md` router skill

Add a context-awareness note:
```markdown
## Context Budget

MCP responses consume your context window. Use the most targeted inspect action available:
- Know the node name? → inspect.node
- Need the overall layout? → inspect.summary (concise, maxDepth: 2)
- Need a section? → inspect.subtree
- LAST RESORT: inspect.tree (with maxDepth: 3)
```

## Acceptance Criteria
- [ ] All 6 skills updated with progressive navigation guidance
- [ ] plasmic-inspect.md has explicit step-by-step navigation pattern
- [ ] plasmic-edit.md instructs targeted verification after mutations
- [ ] plasmic.md router includes context budget awareness
- [ ] No skill instructs the agent to call inspect.tree without maxDepth
- [ ] Skills reference `format: "concise"` where appropriate
- [ ] Skills reference truncation hints (how to follow them)

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Agent receives truncation hint | Skill should teach: follow the hint, use subtree to drill in |
| Agent needs full tree for restructuring | Skill permits inspect.tree with explicit maxDepth |
| Small component (< 10 nodes) | summary without concise is fine — skills don't over-optimize for tiny components |

## Out of Scope
- Automatic skill selection based on component size
- Dynamic skill modification based on context window remaining
