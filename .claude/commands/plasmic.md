You have access to Plasmic MCP tools for interacting with Plasmic Studio.

## Available Tools
- `set-project(projectId)` — Load a project into memory. Must be called before model-reading tools.
- `list-projects()` — List all accessible projects. No active project required.
- `get-project-meta()` — Get project metadata (name, counts, tokens). Requires active project.
- `list-components()` — List all pages and components with UUIDs and paths. Requires active project.
- `get-component-tree(componentUuid)` — Get a component's full element tree as JSON (tags, CSS, text, images, layout). Requires active project.
- `get-tokens(type?)` — Get design tokens (colors, spacing, fonts) grouped by type. Optional type filter. Requires active project.
- `create-page(name, path, body)` — Create a new page with a PlasmicElement tree. Requires active project.
- `update-text(componentUuid, nodeRef, text)` — Change text content on a node.
- `update-styles(componentUuid, nodeRef, styles)` — Change CSS styles on a node.
- `add-child(componentUuid, parentRef, child, position)` — Add a new element.
- `remove-child(componentUuid, nodeRef)` — Remove an element.
- `move-child(componentUuid, nodeRef, newParentRef, position)` — Move an element.
- `begin-batch()` / `end-batch()` — Group multiple edits into a single save.
- `undo()` — Revert the last operation.
- `refresh-project()` — Reload project from server (clears undo history).

## Instructions
1. If no project is set, call `list-projects` and ask the user which one to work on, then call `set-project`.
2. Interpret the user's request and route to the appropriate action:
   - "create a page", "add a page", "make a new page" → build a PlasmicElement tree and call `create-page`. Use `/plasmic-patterns` for validated page section patterns (hero, grid, card, form, pricing, testimonial, CTA, navigation, footer).
   - "what pages exist", "show me the project", "list components" → call `get-project-meta` and `list-components`
   - "show me the homepage", "what does X look like" → find the component UUID via `list-components`, then call `get-component-tree`
   - "what colors are available", "show me the design tokens", "what fonts" → call `get-tokens` (optionally with a type filter)
   - "change X to Y", "update the heading", "make it bigger", "make the background blue" → delegate to `/plasmic-edit`
   - "add a section", "insert a card", "add a testimonial below the hero" → delegate to `/plasmic-edit`
   - "remove the footer", "delete the sidebar" → delegate to `/plasmic-edit`
   - "undo", "revert that", "undo the last change" → call `undo()` directly
   - "refresh", "reload the project", "sync with server" → call `refresh-project()` directly
   - Ambiguous request → ask a clarifying question
3. Summarize results clearly. For component trees, describe the structure in human-readable terms rather than dumping raw JSON.

## User's Request
$ARGUMENTS
