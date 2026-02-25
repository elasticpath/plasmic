You are inspecting a Plasmic project to help the developer understand its structure.

## Available Tools
- `set-project(projectId)` — Load a project. Call first if no project is active.
- `list-projects()` — List accessible projects.
- `get-project-meta()` — Get project metadata (name, component count, page count, tokens).
- `list-components()` — List all pages and components with UUIDs and paths.
- `get-component-summary(componentUuid, maxDepth?)` — Get a compact outline of a component's structure (~2KB). Shows type, tag, name, uuid, childCount per node. No styles or text. **Use this first when inspecting a component.**
- `get-node-details(componentUuid, nodeRef)` — Get full details (styles, text, attrs) for a single node (~300B). Children shown as summaries. **Use this to drill into specific nodes.**
- `get-component-tree(componentUuid, maxDepth?, excludeStyles?, summaryOnly?)` — Get full tree with all details (large). Only use when the developer explicitly needs the complete detailed output.
- `export-component-tree(componentUuid)` — Write full tree to temp file. Returns file path + summary. Use Read tool to inspect sections. Best for complex components.
- `get-subtree(componentUuid, nodeRef, maxDepth?, excludeStyles?)` — Get the full tree rooted at a specific node. Useful when the developer wants to see a specific section's full tree (e.g., just the hero or footer) without loading the whole component.
- `list-variants(componentUuid)` — List all variants for a component: global (breakpoints), component (custom), style (hover/focus). Use to discover variant names/UUIDs.
- `create-style-variant(componentUuid, selector, nodeRef?)` — Create a new interaction state variant. Use `/plasmic-edit` for the full editing workflow.
- `create-variant-group(componentUuid, name, type?, initialVariants?)` — Create a named variant group. Use `/plasmic-edit` for the full editing workflow.
- `get-tokens(type?)` — Get design tokens (colors, spacing, fonts) grouped by type. Optional type filter.
- `get-page-meta(componentUuid)` — Get page metadata (title, description, OG image, canonical URL, path). Only for page components.
- `get-preview-url(componentUuid)` — Get preview and studio URLs for a page or component.

## Instructions
1. If no project is active, call `list-projects` and ask the user which project, then `set-project`.
2. Call `get-project-meta` for an overview.
3. Call `list-components` for the full listing.
4. Present the results clearly:
   - Project name and summary stats
   - Pages listed with their paths
   - Components listed with their names
5. If the user asked about a specific component or page:
   a. Call `get-component-summary` to get the compact outline.
   b. Describe the structure in human-readable terms (e.g., "a vertical stack containing a heading, paragraph, and 3-column grid of cards").
   c. If the user asks about a specific node's styles or content, call `get-node-details` for that node.
   d. Only use `get-component-tree` or `export-component-tree` if the user explicitly needs the complete detailed tree.
6. If the user asked about design tokens, colors, or fonts, call `get-tokens` (optionally filtered by type).
7. If the user asked about variants, breakpoints, hover states, or responsive setup, find the component UUID via `list-components`, then call `list-variants(componentUuid)`.
8. If the user asks about page metadata, SEO settings, or page title/description, call `get-page-meta(componentUuid)` for the page.
9. If the user asks for a preview link or studio URL, call `get-preview-url(componentUuid)`.
10. For large component trees, the summary already shows childCounts — describe the structure at the top level and mention deeper nesting counts.

## User's Request
$ARGUMENTS
