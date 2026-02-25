You have access to Plasmic MCP tools for interacting with Plasmic Studio.

## Available Tools
- `set-project(projectId)` — Load a project into memory. Must be called before model-reading tools.
- `list-projects()` — List all accessible projects. No active project required.
- `get-project-meta()` — Get project metadata (name, counts, tokens). Requires active project.
- `list-components()` — List all pages and components with UUIDs and paths. Requires active project.
- `get-component-summary(componentUuid, maxDepth?)` — Get a compact outline of a component's structure (~2KB). No styles or text. **Preferred for exploring structure.**
- `get-node-details(componentUuid, nodeRef)` — Get full details for a single node (~300B). **Use to inspect specific nodes.**
- `get-component-tree(componentUuid, maxDepth?, excludeStyles?, summaryOnly?)` — Get a component's full element tree as JSON (tags, CSS, text, images, layout). Large output. Only use when full detail is needed.
- `export-component-tree(componentUuid)` — Write full tree to temp file. Returns file path + compact summary. Use Read tool to inspect sections.
- `get-subtree(componentUuid, nodeRef, maxDepth?, excludeStyles?)` — Get the full tree rooted at a specific node. Use when you only need a section of the tree rather than the whole component.
- `get-tokens(type?)` — Get design tokens (colors, spacing, fonts) grouped by type. Optional type filter. Requires active project.
- `create-page(name, path, body)` — Create a new page with a PlasmicElement tree. Requires active project.
- `create-component(name, body)` — Create a new reusable component (not a page) with a PlasmicElement tree.
- `clone-component(sourceUuid, name, path?)` — Duplicate an existing page or component. Deep copy with a new name.
- `rename-component(componentUuid, newName, newPath?)` — Rename a page or component. Auto-deduplicates names. Optional `newPath` updates page URL.
- `get-page-meta(componentUuid)` — Get page metadata (title, description, OG image, canonical, path). Only for pages.
- `update-page-meta(componentUuid, title?, description?, openGraphImage?, canonical?, path?)` — Set page SEO metadata. Only provided fields are updated.
- `get-preview-url(componentUuid)` — Get preview and studio URLs for a page or component. No server call needed.
- `delete-component(componentUuid, force?)` — Delete a page or component. Checks for references; use `force: true` to override.
- `list-variants(componentUuid)` — List all variants for a component: global (breakpoints), component (custom), style (hover/focus).
- `create-style-variant(componentUuid, selector, nodeRef?)` — Create a new interaction state variant (hover, focus, pressed, etc.). Optional `nodeRef` scopes to a specific element.
- `create-variant-group(componentUuid, name, type?, initialVariants?)` — Create a named variant group (e.g., "Size" with "Small"/"Large"). Types: "single" (default), "multi", "toggle".
- `update-text(componentUuid, nodeRef, text, variant?, dynamic?, fallback?, html?)` — Change text content. Set `dynamic: true` to bind a JS expression (e.g., `$ctx.product.name`). Optional `fallback` for null values. Optional `html: true` to render as HTML.
- `update-styles(componentUuid, nodeRef, styles, variant?)` — Change CSS styles. Values accept `token:TokenName` for design token references. Border/outline shorthands (e.g., `"1px solid #ccc"`) are auto-expanded.
- `update-attrs(componentUuid, nodeRef, attrs, variant?)` — Set or remove HTML/ARIA/data-* attributes. Pass `null` to delete. Prefix with `$` or wrap in `{{...}}` for dynamic expressions.
- `add-child(componentUuid, parentRef, child, position, slot?)` — Add a new element. Optional `slot` targets a named slot on a TplComponent instance.
- `remove-child(componentUuid, nodeRef)` — Remove an element.
- `move-child(componentUuid, nodeRef, newParentRef, position)` — Move an element.
- `clone-child(componentUuid, nodeRef, newName?, parentRef?, position?)` — Deep-clone a node and all descendants with new UUIDs. Inserted as next sibling by default; optional `parentRef` + `position` for elsewhere.
- `list-style-properties(filter?)` — List all valid CSS property names. Optional substring filter (e.g., `"border"`, `"flex"`).
- `begin-batch()` / `end-batch()` — Group multiple edits into a single save.
- `undo()` — Revert the last operation.
- `save-project()` — Force a full save of the current in-memory model to the server.
- `refresh-project()` — Reload project from server (clears undo history).

All edit tools (`update-text`, `update-styles`, `update-attrs`, `add-child`, `remove-child`, `move-child`, `clone-child`) accept an optional `dryRun: true` parameter to preview what would change without persisting.

## Instructions
1. If no project is set, call `list-projects` and ask the user which one to work on, then call `set-project`.
2. Interpret the user's request and route to the appropriate action:
   - "create a page", "add a page", "make a new page" → build a PlasmicElement tree and call `create-page`. Use `/plasmic-patterns` for validated page section patterns (hero, grid, card, form, pricing, testimonial, CTA, navigation, footer).
   - "create a component", "make a card component", "build a header component" → delegate to `/plasmic-create-component`
   - "duplicate the header", "clone this component", "copy the homepage" → delegate to `/plasmic-create-component` (it handles both create and clone)
   - "what pages exist", "show me the project", "list components" → call `get-project-meta` and `list-components`
   - "show me the homepage", "what does X look like" → find the component UUID via `list-components`, then call `get-component-summary` (for overview) or `get-node-details` (for specific nodes)
   - "get subtree", "show me just the hero section tree" → find the component UUID and node reference, then call `get-subtree`
   - "what colors are available", "show me the design tokens", "what fonts" → call `get-tokens` (optionally with a type filter)
   - "what variants exist", "show breakpoints", "list hover states" → find the component UUID via `list-components`, then call `list-variants`
   - "add hover state", "create a focus variant", "add :active state" → find the component UUID via `list-components`, then call `create-style-variant`. Optionally specify `nodeRef` to scope to a specific element.
   - "add a size variant", "create variant group", "add Small/Medium/Large variants" → find the component UUID, then call `create-variant-group` with the group name and optional `initialVariants` array.
   - "change X to Y", "update the heading", "make it bigger", "make the background blue" → delegate to `/plasmic-edit`
   - "make the heading smaller on mobile", "change hover color", "set font size for tablet" → delegate to `/plasmic-edit` (variant-aware editing)
   - "add a section", "insert a card", "add a testimonial below the hero" → delegate to `/plasmic-edit`
   - "remove the footer", "delete the sidebar" → delegate to `/plasmic-edit`
   - "clone this card", "duplicate the hero section node", "copy the button" → delegate to `/plasmic-edit` (node cloning within a component)
   - "set the href", "add aria-label", "set data-testid", "update the placeholder" → delegate to `/plasmic-edit` (HTML attribute editing)
   - "bind this text to data", "make the title dynamic", "show $ctx.user.name" → delegate to `/plasmic-edit` (dynamic text bindings)
   - "use the brand color token", "apply the primary color token" → delegate to `/plasmic-edit` (design token references)
   - "add content to the icon slot", "put text in the header slot" → delegate to `/plasmic-edit` (slot content targeting)
   - "what CSS properties are valid", "list border properties" → call `list-style-properties` directly (optionally with a `filter`)
   - "rename the homepage", "change component name to X" → call `rename-component` with the component UUID and new name
   - "set the page title", "update page description", "change page path" → call `update-page-meta` with the relevant fields
   - "what's the page metadata", "show me the SEO settings" → call `get-page-meta` to read current values
   - "give me the preview URL", "preview link for the homepage" → call `get-preview-url`
   - "delete the old page", "remove this component" → call `delete-component` (will error if referenced by other components)
   - "undo", "revert that", "undo the last change" → call `undo()` directly
   - "save", "force save", "save to server" → call `save-project()` directly
   - "refresh", "reload the project", "sync with server" → call `refresh-project()` directly
   - "what would happen if...", "preview the change", "dry run" → use `dryRun: true` on the edit tool
   - Ambiguous request → ask a clarifying question
3. Summarize results clearly. For component structures, describe in human-readable terms rather than dumping raw JSON.

## User's Request
$ARGUMENTS
