# Plasmic Edit Skills (Milestone 2)

## Jobs to Be Done

- As a developer using Claude Code, I want to describe edits in natural language ("make the hero background dark blue", "add a testimonial section below the features") and have Claude map them to the right MCP tool calls, so that I don't need to know UUIDs or JSON structures.
- As a developer, I want a conversational editing loop where I can see the current state, make a change, see the result, and iterate, so that editing feels fluid and responsive.

## Architecture

### How Skills Map to Tools

```
Developer: "make the hero heading bigger and change it to Welcome Back"
    |
    v
/plasmic-edit skill (natural language interpreter)
    |  1. Calls get-component-tree to understand current structure
    |  2. Identifies "hero heading" → node "Hero Title" (UUID: abc-123)
    |  3. Maps "bigger" → update-styles with larger fontSize
    |  4. Maps "change to Welcome Back" → update-text
    v
MCP tool calls:
    update-styles(Homepage, "abc-123", { "fontSize": "56px" })
    update-text(Homepage, "abc-123", "Welcome Back")
```

### Skill Files

```
.claude/commands/
├── plasmic.md                   # Updated: routes edit intents to plasmic-edit
├── plasmic-edit.md              # NEW: natural language editing workflow
├── plasmic-create-page.md       # Unchanged from M1
├── plasmic-inspect.md           # Unchanged from M1
└── plasmic-patterns.md          # Unchanged from M1
```

## Skills

### `/plasmic-edit` — Natural Language Editing Workflow

**Trigger:** Developer invokes `/plasmic-edit` with an edit description, or `/plasmic` routes an edit intent here.

**Behavior:**

1. Ensure a project is active. If not, prompt for project selection.
2. Identify the target component/page. If ambiguous, call `list-components` and ask.
3. Call `get-component-tree` to understand the current structure.
4. Parse the developer's description to determine:
   - Which node(s) to modify (by name, position, or content description)
   - What operation to apply (text change, style change, add, remove, move)
5. For complex edits (multiple changes), use `begin-batch` / `end-batch`.
6. Call the appropriate MCP tools.
7. Report what changed. Offer to show the updated tree or make further edits.

**Prompt structure:**
```markdown
You are editing an existing page or component in a Plasmic project.

## Available Tools
- `set-project(projectId)` — Load a project. Call first if no project is active.
- `list-projects()` — List accessible projects.
- `list-components()` — List all pages and components with UUIDs.
- `get-component-tree(componentUuid)` — Get a component's current structure.
- `update-text(componentUuid, nodeRef, text)` — Change text content on a node.
- `update-styles(componentUuid, nodeRef, styles)` — Change CSS styles on a node.
- `add-child(componentUuid, parentRef, child, position)` — Add a new element.
- `remove-child(componentUuid, nodeRef)` — Remove an element.
- `move-child(componentUuid, nodeRef, newParentRef, position)` — Move an element.
- `begin-batch()` / `end-batch()` — Group edits into a single save.
- `undo()` — Revert the last operation.
- `refresh-project()` — Reload project from server.

## Editing Workflow
1. If no project is active, set one up.
2. Call get-component-tree to see the current structure of the target component.
3. Identify the node(s) to modify. Use node names from the tree output.
4. Choose the right tool for each edit:
   - Text changes → update-text
   - Style changes → update-styles (use camelCase CSS: fontSize, backgroundColor, etc.)
   - Adding elements → add-child with a PlasmicElement JSON body
   - Removing elements → remove-child
   - Rearranging → move-child
5. For 3+ edits, wrap in begin-batch / end-batch.
6. After editing, call get-component-tree again to show the updated structure.
7. If a save conflict occurs (412), explain and suggest refresh-project.

## Node References
Nodes can be referenced by:
- UUID: exact match (from get-component-tree output)
- Name: the node's name in the tree (e.g., "Hero Title")
- Path: dot-separated (e.g., "HeroSection.Title")

## Style Property Reference
Use React CSSProperties format (camelCase):
- fontSize, fontWeight, fontFamily
- color, backgroundColor, borderColor
- padding, margin, gap (shorthand values as strings: "16px", "8px 16px")
- borderRadius, border (e.g., "1px solid #ccc")
- width, height, maxWidth, minHeight
- display, flexDirection, alignItems, justifyContent
- position, top, right, bottom, left
- opacity, overflow, textAlign

## PlasmicElement Reference (for add-child)
When adding new elements, construct a PlasmicElement JSON:

Container: { "type": "vbox", "styles": { ... }, "children": [ ... ] }
Text: { "type": "text", "value": "Hello", "tag": "h2", "styles": { ... } }
Image: { "type": "img", "src": "https://...", "styles": { ... } }
Button: { "type": "button", "value": "Click", "styles": { ... } }

## User's Request
$ARGUMENTS
```

### `/plasmic` — Updated Router (M2 additions)

Add edit intent routing:

```markdown
## Route based on intent (additions for M2):
- "change X to Y", "update the heading", "make it bigger" → delegate to /plasmic-edit
- "add a section", "insert a card" → delegate to /plasmic-edit
- "remove the footer", "delete the sidebar" → delegate to /plasmic-edit
- "undo", "revert that" → call undo() directly
- "refresh", "reload the project" → call refresh-project() directly
```

## Acceptance Criteria

- [ ] `/plasmic-edit` skill exists and handles natural language edit descriptions
- [ ] `/plasmic` router correctly routes edit intents to `/plasmic-edit`
- [ ] Skill calls `get-component-tree` before editing to understand current structure
- [ ] Skill uses `begin-batch` / `end-batch` for multi-edit requests
- [ ] Skill reports results clearly: what changed, new revision number, any warnings
- [ ] Skill handles node ambiguity: when multiple matches, presents options to developer
- [ ] Skill handles save conflicts: explains 412 error, suggests `refresh-project`
- [ ] Skill suggests `undo` when developer expresses regret ("actually, change it back")

## Happy Path

### Simple text edit
```
Developer: /plasmic-edit change the homepage hero heading to "Welcome Back"

Claude: Let me look at the homepage structure.
  → calls get-component-tree(Homepage UUID)

Claude: Found "Hero Title" (h1) currently containing "Welcome to My Store".
  → calls update-text(Homepage UUID, "Hero Title", "Welcome Back")

Claude: Done — updated "Hero Title" to "Welcome Back" (revision 42).
  Want to make any other changes?
```

### Multi-edit with batch
```
Developer: /plasmic-edit on the about page, change the title to "Our Story",
           make the subtitle italic, and add a team photo below the hero

Claude: Let me look at the About page.
  → calls get-component-tree(About UUID)

Claude: I see the structure. I'll batch these 3 changes.
  → calls begin-batch()
  → calls update-text(About, "Page Title", "Our Story")
  → calls update-styles(About, "Subtitle", { "fontStyle": "italic" })
  → calls add-child(About, "Hero Section", {
      "type": "img",
      "src": "https://placeholder.com/team.jpg",
      "styles": { "width": "100%", "borderRadius": "12px" },
      "attrs": { "alt": "Our team" }
    }, "last")
  → calls end-batch()

Claude: Batch saved (revision 43):
  1. Changed "Page Title" text to "Our Story"
  2. Made "Subtitle" italic
  3. Added team photo image below the hero section
```

### Undo flow
```
Developer: /plasmic undo that

Claude:
  → calls undo()

Claude: Undone — reverted the batch edit (revision 44).
  The About page is back to its previous state.
```

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Ambiguous node reference ("the title" matches 3 nodes) | Show all matches with UUIDs and context, ask developer to clarify |
| Developer references a non-existent node | Show current tree structure and suggest correct names |
| Edit request targets wrong component | Ask: "Did you mean the Homepage or the About page?" |
| Developer asks to edit something that requires variant support | Explain: "Editing responsive/variant styles isn't supported yet. This will edit the base variant." |
| Very large tree makes get-component-tree output overwhelming | Summarize top 2-3 levels, expand on request |

## Out of Scope

- Variant-aware editing (M2 edits base variant only)
- Visual diff / before-after comparison
- Undo across sessions (undo history is session-scoped)
- Suggesting edits proactively ("this heading could use more contrast")
- Template-based page generation (covered by M1 `/plasmic-create-page`)
