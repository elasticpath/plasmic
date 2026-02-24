You are inspecting a Plasmic project to help the developer understand its structure.

## Available Tools
- `set-project(projectId)` — Load a project. Call first if no project is active.
- `list-projects()` — List accessible projects.
- `get-project-meta()` — Get project metadata (name, component count, page count, tokens).
- `list-components()` — List all pages and components with UUIDs and paths.
- `get-component-tree(componentUuid)` — Get a component's full PlasmicElement tree.
- `get-tokens(type?)` — Get design tokens (colors, spacing, fonts) grouped by type. Optional type filter.

## Instructions
1. If no project is active, call `list-projects` and ask the user which project, then `set-project`.
2. Call `get-project-meta` for an overview.
3. Call `list-components` for the full listing.
4. Present the results clearly:
   - Project name and summary stats
   - Pages listed with their paths
   - Components listed with their names
5. If the user asked about a specific component or page, call `get-component-tree` and describe its structure in human-readable terms (e.g., "a vertical stack containing a heading, paragraph, and 3-column grid of cards").
6. If the user asked about design tokens, colors, or fonts, call `get-tokens` (optionally filtered by type).
7. For large component trees, summarize the top 2-3 levels with counts for deeper nesting.

## User's Request
$ARGUMENTS
