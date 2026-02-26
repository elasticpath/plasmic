You have access to Plasmic MCP tools for interacting with Plasmic Studio.

## Tools (8 domain tools)

### Session & Project
- `project({ action: "set", projectId })` — Load project into memory. Must be called first.
- `project({ action: "refresh" })` — Reload from server (clears undo history).
- `project({ action: "save" })` — Force save current in-memory model to server.
- `project({ action: "list" })` — List all accessible projects. No active project required.
- `project({ action: "get-meta" })` — Project metadata: name, counts, tokens, global variant groups.

### Discovery & Inspection
- `component({ action: "list" })` — All pages and components with UUIDs and paths.
- `inspect({ action: "summary", componentUuid, maxDepth? })` — Compact outline (~2KB). **Start here.**
- `inspect({ action: "node", componentUuid, nodeRef })` — Full details for one node (~300B).
- `inspect({ action: "tree", componentUuid, maxDepth?, excludeStyles?, summaryOnly? })` — Full tree with styles/text. Large output.
- `inspect({ action: "export", componentUuid })` — Write full tree to temp file. Use Read tool to inspect.
- `inspect({ action: "subtree", componentUuid, nodeRef, maxDepth?, excludeStyles? })` — Subtree from a specific node.

### Design System (Read)
- `design({ action: "list-tokens", tokenType? })` — Design tokens (Color, Spacing, FontSize, FontFamily, LineHeight, Opacity).
- `design({ action: "list-mixins" })` — Reusable style bundles with uuid, name, styles.
- `design({ action: "list-animations" })` — @keyframes animations with uuid, name, keyframeCount.
- `design({ action: "list-themes" })` — Site themes with index, isActive, defaultStyles, themeStyles.
- `data({ action: "list-data-tokens" })` — Data tokens accessible as `$ctx.tokenName` in expressions.
- `variant({ action: "list-global-groups" })` — Global variant groups (screen breakpoints, custom).
- `design({ action: "list-assets", assetType? })` — Image assets with uuid, name, type, dimensions.
- `data({ action: "list-functions" })` — Registered custom functions with params and types.
- `data({ action: "list-splits" })` — A/B test splits (experiments and segments).

### Component Introspection (Read)
- `component({ action: "list-props", componentUuid })` — Component parameters with type, kind, default value.
- `component({ action: "list-states", componentUuid })` — State variables with type, access level, initial value.
- `data({ action: "list-queries", componentUuid })` — Data queries (client-side and server-side).
- `interaction({ action: "list", componentUuid, nodeRef? })` — Event handlers on nodes.
- `variant({ action: "list", componentUuid })` — All variants: global (breakpoints), component (custom), style (hover/focus).
- `data({ action: "get-code-meta", componentUuid })` — Code component metadata: importPath, props, defaultStyles.

### Page/Component Lifecycle
- `component({ action: "create-page", name, path, body })` — New page with PlasmicElement tree.
- `component({ action: "create", name, body })` — New reusable component.
- `component({ action: "clone", sourceUuid, name, path? })` — Deep-copy component or page.
- `component({ action: "rename", componentUuid, newName, newPath? })` — Rename (auto-deduplicates).
- `component({ action: "delete", componentUuid, force? })` — Delete (checks references; `force: true` overrides).
- `component({ action: "convert-to-page", componentUuid, path? })` — Convert component to page.
- `component({ action: "convert-to-component", componentUuid })` — Convert page to component.
- `component({ action: "extract", componentUuid, nodeRef, name })` — Extract subtree into a new reusable component.
- `inspect({ action: "page-meta", componentUuid })` — Read SEO metadata (title, description, OG image, canonical).
- `component({ action: "update-page-meta", componentUuid, title?, description?, openGraphImage?, canonical?, path? })` — Set SEO metadata.
- `inspect({ action: "preview-url", componentUuid })` — Preview and studio URLs.

### Variants
- `variant({ action: "create-style", componentUuid, selector, nodeRef? })` — Create :hover, :focus, :active, etc.
- `variant({ action: "create-group", componentUuid, name, type?, initialVariants? })` — Named group (single/multi/toggle).
- `variant({ action: "rename", componentUuid, variantRef, newName })` — Rename a component-level variant.
- `variant({ action: "remove", componentUuid, variantRef })` — Remove a component-level variant.
- `variant({ action: "create-global-group", name, type?, initialVariants? })` — Site-level variant group.
- `variant({ action: "create-screen", groupRef, name })` — Add a screen breakpoint variant to a global group.
- `variant({ action: "update-screen", groupRef, variantRef, name? })` — Update a screen variant.
- `variant({ action: "add-global", groupRef, name })` — Add variant to a global group.
- `variant({ action: "remove-global-group", groupRef })` — Remove global group.
- `variant({ action: "rename-global", groupRef, variantRef, newName })` — Rename variant in global group.

### Node Editing
- `node({ action: "update-text", componentUuid, nodeRef, text, variant?, dynamic?, fallback?, html? })` — Set text content. `dynamic: true` for JS expressions.
- `node({ action: "update-rich-text", componentUuid, nodeRef, text, marks[], variant? })` — Formatted text with bold/italic/underline/strikethrough/link/code marks.
- `node({ action: "update-styles", componentUuid, nodeRef, styles, variant? })` — CSS styles. `token:TokenName` references supported.
- `node({ action: "update-attrs", componentUuid, nodeRef, attrs, variant? })` — HTML/ARIA/data-* attributes. `null` removes, `$` prefix for dynamic.
- `node({ action: "add", componentUuid, parentRef, child, position?, slot? })` — Insert element. `slot` targets named slot on TplComponent.
- `node({ action: "remove", componentUuid, nodeRef })` — Remove element.
- `node({ action: "move", componentUuid, nodeRef, newParentRef, position?, slot? })` — Move element. `slot` for TplComponent target.
- `node({ action: "clone", componentUuid, nodeRef, newName?, parentRef?, position?, slot? })` — Deep-clone with new UUIDs.
- `node({ action: "reorder", componentUuid, parentRef, childRefs[] })` — Reorder children within a container.
- `node({ action: "set-image", componentUuid, nodeRef, src?, assetRef?, variant? })` — Set image from URL or uploaded asset.

### Visibility & Data Binding
- `node({ action: "set-visibility", componentUuid, nodeRef, visible, variant? })` — `true` (visible) / `false` (not rendered) / `"displayNone"` (CSS display:none).
- `data({ action: "set-data-cond", componentUuid, nodeRef, condition, variant? })` — JS conditional expression (e.g., `"$ctx.user.isLoggedIn"`). `null` removes.
- `data({ action: "set-data-rep", componentUuid, nodeRef, collection, elementVariable?, indexVariable? })` — Repeat element for each item in collection. `null` collection removes.

### Design Token CRUD
- `design({ action: "create-token", name, tokenType, value })` — New token (Color/Spacing/FontSize/FontFamily/LineHeight/Opacity).
- `design({ action: "update-token", tokenRef, name?, value? })` — Rename or change value.
- `design({ action: "remove-token", tokenRef })` — Remove token (inlines all references first).
- `design({ action: "duplicate-token", tokenRef, newName })` — Clone token.

### Mixin CRUD
- `design({ action: "create-mixin", name, styles? })` — New reusable style bundle.
- `design({ action: "update-mixin", mixinRef, name?, styles? })` — Rename or update styles.
- `design({ action: "remove-mixin", mixinRef })` — Delete mixin (cleans up references).
- `node({ action: "apply-mixin", componentUuid, nodeRef, mixinRef })` — Apply mixin to element (idempotent).
- `node({ action: "detach-mixin", componentUuid, nodeRef, mixinRef })` — Remove mixin from element.

### Animation CRUD
- `design({ action: "create-animation", name, keyframes? })` — New @keyframes (keyframes: `[{ percentage: 0, styles: {...} }, ...]`).
- `design({ action: "update-animation", seqRef, name?, keyframes? })` — Update animation.
- `design({ action: "remove-animation", seqRef })` — Delete (cleans up node references).
- `node({ action: "add-animation", componentUuid, nodeRef, seqRef, duration?, delay?, timingFunction?, iterationCount?, direction?, fillMode? })` — Attach animation.
- `node({ action: "remove-animation", componentUuid, nodeRef, seqRef?, animationIndex? })` — Detach animation.

### Theme CRUD
- `design({ action: "create-theme", defaultStyles?, themeStyles?, setActive? })` — New theme. `themeStyles`: `[{ selector: "h1", styles: {...} }]`.
- `design({ action: "update-theme", themeIndex, defaultStyles?, themeStyles? })` — Update theme styles.
- `design({ action: "remove-theme", themeIndex })` — Delete (cannot remove active theme).
- `design({ action: "set-active-theme", themeIndex? })` — Set active theme (`null` deactivates).

### Data Token CRUD
- `data({ action: "create-data-token", name, type, value })` — New data token accessible as `$ctx.tokenName`.
- `data({ action: "update-data-token", tokenRef, name?, value? })` — Rename or change value.
- `data({ action: "remove-data-token", tokenRef })` — Delete data token.

### Asset Management
- `design({ action: "upload-asset", name, assetType?, url?, dataUri? })` — Upload image from URL or data URI.
- `design({ action: "rename-asset", assetRef, newName })` — Rename asset.
- `design({ action: "remove-asset", assetRef })` — Delete asset (cleans up references).

### Component Configuration
- `component({ action: "add-prop", componentUuid, name, type, defaultValue?, description? })` — Add prop (text/number/boolean/object/href/eventHandler).
- `component({ action: "remove-prop", componentUuid, propRef })` — Remove prop.
- `component({ action: "update-prop", componentUuid, propRef, name?, defaultValue?, description? })` — Update prop.
- `component({ action: "add-state", componentUuid, name, variableType, accessType, initialValue? })` — Add state (text/number/boolean/array/object; private/readonly/writable).
- `component({ action: "remove-state", componentUuid, stateRef })` — Remove state variable.
- `component({ action: "update-state", componentUuid, stateRef, name?, variableType?, accessType?, initialValue? })` — Update state.
- `data({ action: "add-query", componentUuid, name, queryType? })` — Add data query (queryType: "dataQuery" | "serverQuery", default "dataQuery").
- `data({ action: "remove-query", componentUuid, queryRef })` — Remove query.
- `data({ action: "update-query", componentUuid, queryRef, name })` — Rename query.
- `interaction({ action: "add", componentUuid, nodeRef, event, actionName, args?, condition?, interactionName? })` — Add event handler.
- `interaction({ action: "update", componentUuid, nodeRef, event, interactionIndex, actionName?, args?, condition?, interactionName? })` — Update existing handler.
- `interaction({ action: "remove", componentUuid, nodeRef, interactionIndex? })` — Remove handler(s).

### A/B Testing
- `data({ action: "create-split", name, type, slices })` — New experiment or segment.
- `data({ action: "update-split", splitRef, name?, slices?, status? })` — Update split.
- `data({ action: "remove-split", splitRef })` — Delete split.

### Utilities
- `inspect({ action: "style-properties", filter? })` — Valid CSS property names (optional substring filter).
- `project({ action: "begin-batch" })` / `project({ action: "end-batch" })` — Group multiple edits into a single save.
- `project({ action: "undo" })` — Revert the last operation.

All edit tools accept `dryRun: true` to preview changes without persisting.

## Instructions
1. If no project is set, call `project({ action: "list" })` and ask the user which one to work on, then call `project({ action: "set" })`.
2. Interpret the user's request and route to the appropriate action:

   **Page/Component Creation:**
   - "create a page", "add a page", "make a new page" → build a PlasmicElement tree and call `component({ action: "create-page" })`. Use `/plasmic-patterns` for validated section patterns.
   - "create a component", "make a card component" → delegate to `/plasmic-create-component`
   - "duplicate", "clone", "copy" → delegate to `/plasmic-create-component` (handles both create and clone)

   **Inspection & Discovery:**
   - "what pages exist", "show me the project", "list components" → call `project({ action: "get-meta" })` and `component({ action: "list" })`
   - "show me the homepage", "what does X look like" → find UUID via `component({ action: "list" })`, then `inspect({ action: "summary" })` or `inspect({ action: "node" })`
   - "get subtree", "show me just the hero section" → `inspect({ action: "subtree" })`
   - "what colors/tokens/fonts are available" → `design({ action: "list-tokens" })`
   - "what variants/breakpoints exist" → `variant({ action: "list" })`
   - "what props does this component have" → `component({ action: "list-props" })`
   - "what states does this component have" → `component({ action: "list-states" })`
   - "what queries are defined" → `data({ action: "list-queries" })`
   - "what interactions are on this button" → `interaction({ action: "list" })`
   - "what mixins are available" → `design({ action: "list-mixins" })`
   - "what animations exist" → `design({ action: "list-animations" })`
   - "what themes are defined" → `design({ action: "list-themes" })`
   - "list data tokens" → `data({ action: "list-data-tokens" })`
   - "what global variant groups exist" → `variant({ action: "list-global-groups" })`
   - "what images/assets are uploaded" → `design({ action: "list-assets" })`
   - "what A/B tests exist" → `data({ action: "list-splits" })`
   - "what custom functions are available" → `data({ action: "list-functions" })`
   - "what are this code component's props" → `data({ action: "get-code-meta" })`
   - Detailed project inspection → delegate to `/plasmic-inspect`

   **Node-Level Editing (delegate to `/plasmic-edit`):**
   - "change X to Y", "update the heading", "make it bigger", "make the background blue" → style/text edits
   - "make the heading smaller on mobile", "change hover color" → variant-aware editing
   - "add a section", "insert a card" → node.add
   - "remove the footer", "delete the sidebar" → node.remove
   - "clone this card", "duplicate the hero" → node cloning
   - "set the href", "add aria-label" → attribute editing
   - "bind this text to data", "make the title dynamic" → dynamic text
   - "make this bold", "add a link in the text", "format the text" → rich text
   - "hide this element", "show only if logged in", "conditional rendering" → visibility/data-cond
   - "repeat for each product", "loop over items", "collection rendering" → data-rep
   - "add onClick handler", "when clicked navigate to", "on hover change color" → interactions (add/update/remove)
   - "apply the heading mixin", "detach mixin from this" → apply/detach mixin
   - "animate this element", "add fade animation" → node animation
   - "set the image", "use this asset" → node.set-image
   - "reorder these children", "move card 3 before card 1" → node.reorder
   - "use the brand color token" → token reference in styles

   **Design System Management (handle directly):**
   - "create a color token", "add a spacing token" → `design({ action: "create-token" })`
   - "rename/update/delete/duplicate a token" → `design({ action: "update-token" })` / `design({ action: "remove-token" })` / `design({ action: "duplicate-token" })`
   - "create a mixin", "update mixin styles" → `design({ action: "create-mixin" })` / `design({ action: "update-mixin" })`
   - "delete a mixin" → `design({ action: "remove-mixin" })`
   - "create a fade-in animation" → `design({ action: "create-animation" })`
   - "update/delete animation" → `design({ action: "update-animation" })` / `design({ action: "remove-animation" })`
   - "create a dark theme", "set active theme" → `design({ action: "create-theme" })` / `design({ action: "set-active-theme" })`
   - "update/delete theme" → `design({ action: "update-theme" })` / `design({ action: "remove-theme" })`
   - "create a data token" → `data({ action: "create-data-token" })`
   - "upload an image", "rename/delete asset" → `design({ action: "upload-asset" })` / `design({ action: "rename-asset" })` / `design({ action: "remove-asset" })`

   **Component Configuration (handle directly):**
   - "add a prop to this component" → `component({ action: "add-prop" })` (types: text, number, boolean, object, href, eventHandler)
   - "remove/rename a prop" → `component({ action: "remove-prop" })` / `component({ action: "update-prop" })`
   - "add a state variable", "create a counter" → `component({ action: "add-state" })` (types: text, number, boolean, array, object)
   - "remove/update state" → `component({ action: "remove-state" })` / `component({ action: "update-state" })`
   - "add a data query", "create server query" → `data({ action: "add-query" })`
   - "remove/update query" → `data({ action: "remove-query" })` / `data({ action: "update-query" })`

   **Variant Management (handle directly):**
   - "add hover state", "create focus variant" → `variant({ action: "create-style" })`
   - "add a size variant group" → `variant({ action: "create-group" })`
   - "rename variant" → `variant({ action: "rename" })` (component-level) or `variant({ action: "rename-global" })` (global)
   - "remove variant" → `variant({ action: "remove" })` (component-level) or `variant({ action: "remove-global-group" })` (global group)
   - "create a global variant group", "add a breakpoint" → `variant({ action: "create-global-group" })`
   - "add a screen breakpoint" → `variant({ action: "create-screen" })`
   - "update screen variant" → `variant({ action: "update-screen" })`
   - "add variant to global group" → `variant({ action: "add-global" })`
   - "remove global variant group" → `variant({ action: "remove-global-group" })`
   - "rename global variant" → `variant({ action: "rename-global" })`

   **A/B Testing (handle directly):**
   - "create an A/B test", "add experiment" → `data({ action: "create-split" })`
   - "update/remove split" → `data({ action: "update-split" })` / `data({ action: "remove-split" })`

   **Page/Component Management (handle directly):**
   - "extract this into a component" → `component({ action: "extract" })`
   - "rename the homepage" → `component({ action: "rename" })`
   - "set the page title", "update page description" → `component({ action: "update-page-meta" })`
   - "what's the page metadata" → `inspect({ action: "page-meta" })`
   - "give me the preview URL" → `inspect({ action: "preview-url" })`
   - "delete the old page" → `component({ action: "delete" })`
   - "convert this to a page" → `component({ action: "convert-to-page" })`
   - "make this a component instead" → `component({ action: "convert-to-component" })`

   **Utilities:**
   - "what CSS properties are valid" → `inspect({ action: "style-properties" })`
   - "undo", "revert that" → `project({ action: "undo" })`
   - "save" → `project({ action: "save" })`
   - "refresh", "reload" → `project({ action: "refresh" })`
   - "dry run", "preview the change" → use `dryRun: true` on any edit tool
   - Ambiguous request → ask a clarifying question

3. Summarize results clearly. For component structures, describe in human-readable terms rather than dumping raw JSON.

## User's Request
$ARGUMENTS
