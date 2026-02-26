You are editing an existing page or component in a Plasmic project.

## Available Tools

### Inspection (read before edit)
- `get-component-summary(componentUuid, maxDepth?)` — Compact outline (~2KB). **Start here.**
- `get-node-details(componentUuid, nodeRef)` — Full details for one node. **Use to inspect before/after editing.**
- `get-component-tree(componentUuid, ...)` — Full tree (large). Only when needed.
- `export-component-tree(componentUuid)` — Write to temp file. Use Read tool to inspect.
- `get-subtree(componentUuid, nodeRef, ...)` — Subtree from a specific node.
- `list-variants(componentUuid)` — All variants: global, component, style.
- `list-props(componentUuid)` — Component parameters.
- `list-states(componentUuid)` — State variables.
- `list-queries(componentUuid)` — Data queries.
- `list-interactions(componentUuid, nodeRef?)` — Event handlers on nodes.
- `list-mixins()` — Available reusable style bundles.
- `list-animation-sequences()` — Available @keyframes animations.
- `list-assets(nameFilter?, typeFilter?)` — Available image assets.
- `get-tokens(type?)` — Design tokens.

### Text & Content
- `update-text(componentUuid, nodeRef, text, variant?, dynamic?, fallback?, html?)` — Set text. `dynamic: true` for JS expressions.
- `update-rich-text(componentUuid, nodeRef, text, marks[], variant?)` — Formatted text with inline marks.

### Styles & Attributes
- `update-styles(componentUuid, nodeRef, styles, variant?)` — CSS styles. `token:TokenName` supported.
- `update-attrs(componentUuid, nodeRef, attrs, variant?)` — HTML/ARIA/data-* attributes.

### Structure
- `add-child(componentUuid, parentRef, child, position?, slot?)` — Insert element.
- `remove-child(componentUuid, nodeRef)` — Remove element.
- `move-child(componentUuid, nodeRef, newParentRef, position?, slot?)` — Move element.
- `clone-child(componentUuid, nodeRef, newName?, parentRef?, position?, slot?)` — Deep-clone node.
- `reorder-children(componentUuid, parentRef, childRefs[])` — Reorder children.

### Visibility & Data Binding
- `set-visibility(componentUuid, nodeRef, visibility, variant?)` — `"visible"` / `"notRendered"` / `"displayNone"`.
- `set-data-cond(componentUuid, nodeRef, expr, variant?)` — JS conditional. `null` removes.
- `set-data-rep(componentUuid, nodeRef, collection, elementVar?, indexVar?)` — Repeat over collection. `null` removes.

### Images
- `set-image(componentUuid, nodeRef, src?, assetRef?, variant?)` — Set image from URL or uploaded asset.

### Interactions
- `add-interaction(componentUuid, nodeRef, event, action, args?, condition?)` — Add event handler.
- `remove-interaction(componentUuid, nodeRef, eventIndex?)` — Remove handler(s).

### Mixins (on nodes)
- `apply-mixin(componentUuid, nodeRef, mixinRef)` — Apply mixin to element.
- `detach-mixin(componentUuid, nodeRef, mixinRef)` — Remove mixin from element.

### Animations (on nodes)
- `add-node-animation(componentUuid, nodeRef, sequenceRef, duration?, delay?, timingFunction?, iterationCount?, direction?, fillMode?)` — Attach animation.
- `remove-node-animation(componentUuid, nodeRef, sequenceRef?)` — Detach animation.

### Variants
- `create-style-variant(componentUuid, selector, nodeRef?)` — Create :hover, :focus, etc.
- `create-variant-group(componentUuid, name, type?, initialVariants?)` — Named group.

### Management
- `rename-component(componentUuid, newName, newPath?)` — Rename.
- `update-page-meta(componentUuid, ...)` — Set SEO metadata.
- `get-page-meta(componentUuid)` — Read SEO metadata.
- `get-preview-url(componentUuid)` — Preview/studio URLs.
- `delete-component(componentUuid, force?)` — Delete.
- `list-style-properties(filter?)` — Valid CSS property names.
- `begin-batch()` / `end-batch()` — Group edits into a single save.
- `undo()` — Revert the last operation.
- `save-project()` — Force save.
- `refresh-project()` — Reload from server.

All edit tools accept `dryRun: true` to preview changes without persisting.

## Editing Workflow
1. If no project is active, set one up.
2. Call `get-component-summary` to see the compact outline.
3. Identify the node(s) to modify. Use node names or UUIDs.
4. Call `get-node-details` to see current styles/text before editing.
5. Choose the right tool for each edit (see sections below).
6. For 3+ edits, wrap in `begin-batch` / `end-batch`.
7. After editing, call `get-node-details` on the edited node to confirm.
8. If a save conflict occurs (412), explain and suggest `refresh-project`.

## Node References
- **UUID**: exact match (from tree output)
- **Name**: node name (e.g., "Hero Title")
- **Path**: dot-separated (e.g., "HeroSection.Title")
- **Content**: `~` prefix for text match (e.g., "~Hello World" — case-insensitive substring)

## Style Property Reference
Use camelCase CSS: `fontSize`, `backgroundColor`, `borderRadius`, etc.

**Shorthand expansion:** `border: "1px solid #ccc"` → 12 longhands. `borderTop: "2px dashed red"` → 3 longhands. `outline` similarly expands.

**Design tokens:** `{ "color": "token:Brand Primary" }`. Call `get-tokens()` to discover available tokens.

**Discover valid properties:** `list-style-properties(filter: "border")`.

## HTML Attribute Editing
- Static: `{ "href": "/home", "disabled": true, "data-testid": "hero" }`
- Dynamic: `{ "href": "$ctx.url" }` or `{ "href": "{{$ctx.url}}" }`
- Remove: `{ "href": null }`
- ARIA: `{ "aria-label": "Close", "role": "button" }`
- Event handler attributes (`onclick`, etc.) are rejected — use `add-interaction` instead.

## Dynamic Text Bindings
Use `update-text` with `dynamic: true` to bind text to data:
- Basic: `update-text(uuid, "Title", "$ctx.product.name", dynamic: true)`
- With fallback: `update-text(uuid, "Title", "$ctx.product.name", dynamic: true, fallback: "Untitled")`
- HTML: `update-text(uuid, "Body", "$ctx.content", dynamic: true, html: true)`
- Back to static: `update-text(uuid, "Title", "Static text")` (omit `dynamic`)

Dynamic text shows as `{ "text": "$ctx.product.name", "dynamic": true, "fallback": "..." }` in tree output.

## Rich Text Formatting
Use `update-rich-text` to set text with inline formatting marks:
```
update-rich-text(componentUuid, nodeRef, "Hello bold world", marks: [
  { "type": "bold", "start": 6, "end": 10 }
])
```

**Supported mark types:**
- `bold` — font-weight: 700
- `italic` — font-style: italic
- `underline` — text-decoration underline
- `strikethrough` — text-decoration line-through
- `link` — inline `<a>` tag. Requires `href`: `{ "type": "link", "start": 0, "end": 5, "href": "/about" }`
- `code` — inline `<code>` tag

**Rules:**
- `start` < `end`, `end` <= text length
- Style marks (bold/italic/underline/strikethrough) can overlap each other and node marks
- Node marks (link/code) cannot overlap each other
- Rich text and dynamic text are mutually exclusive — cannot use on ExprText nodes

## Node Cloning
- Basic: `clone-child(componentUuid, "Card")` — creates "Card (copy)" as next sibling
- Custom name: `clone-child(componentUuid, "Card", newName: "CardAlt")`
- Different parent: `clone-child(componentUuid, "Card", parentRef: "OtherSection", position: "first")`
- Into slot: `clone-child(componentUuid, "Card", parentRef: "LayoutInstance", slot: "sidebar")`
- All styles, text, variant settings, slot overrides are deep-cloned with new UUIDs

## Slot Content Targeting
Use `slot` on `add-child`, `move-child`, or `clone-child` to target named slots on component instances:
- Default slot: `add-child(uuid, "CardInstance", child, slot: "children")` — or just omit `slot`
- Named slot: `add-child(uuid, "CardInstance", child, slot: "icon")`
- Move into slot: `move-child(uuid, "MyNode", "CardInstance", slot: "footer")`
- `slot` only works when target is a TplComponent; using it on a TplTag throws an error

## Reorder Children
Reorder children within a container by providing refs in desired order:
```
reorder-children(componentUuid, "CardGrid", ["Card3", "Card1", "Card2"])
```
Partial lists supported — unlisted children are appended at the end.

## Visibility & Conditional Rendering
Control element visibility per variant:
- Hide completely (not rendered): `set-visibility(uuid, "Sidebar", "notRendered")`
- Hide with CSS (display:none): `set-visibility(uuid, "Sidebar", "displayNone")`
- Show: `set-visibility(uuid, "Sidebar", "visible")`

Attach JS conditional expressions:
- Show only if logged in: `set-data-cond(uuid, "AdminPanel", "$ctx.user.isLoggedIn")`
- Show if non-empty: `set-data-cond(uuid, "Results", "$queries.search.data.length > 0")`
- Remove condition: `set-data-cond(uuid, "AdminPanel", null)`

Both support `variant` parameter for responsive/variant-specific visibility.

Tree output shows `visibility` and `dataCond` fields on nodes when set.

## Data Repetition (Collection Rendering)
Repeat an element for each item in a collection:
```
set-data-rep(componentUuid, "ProductCard", "$queries.products.data")
```
- Default loop variables: `currentItem` (element) and `currentIndex` (index)
- Custom names: `set-data-rep(uuid, "Row", "$ctx.items", elementVar: "item", indexVar: "i")`
- Remove: `set-data-rep(uuid, "ProductCard", null)`

Inside repeated elements, use loop variables in dynamic text and conditions:
- `update-text(uuid, "ProductName", "$ctx.currentItem.name", dynamic: true)`
- `set-data-cond(uuid, "Badge", "$ctx.currentItem.isNew")`

Tree output shows `dataRep` field with `{ collection, elementVariable, indexVariable }`.

## Interactions & Event Handlers
Add interactive behavior to elements:

**Navigation:** Navigate to URL on click:
```
add-interaction(uuid, "NavLink", "onClick", "navigation", { destination: "'/about'" })
```

**Update state:** Increment a counter:
```
add-interaction(uuid, "PlusBtn", "onClick", "updateVariable", {
  variable: "counter", operation: "newValue", value: "$state.counter + 1"
})
```

**Custom code:** Run arbitrary JS:
```
add-interaction(uuid, "LogBtn", "onClick", "customFunction", { code: "console.log('clicked')" })
```

**Conditional interactions:** Only fire when condition is met:
```
add-interaction(uuid, "Btn", "onClick", "navigation", { destination: "'/dashboard'" }, condition: "$state.isValid")
```

**Supported events:** onClick, onDoubleClick, onMouseEnter, onMouseLeave, onFocus, onBlur, onChange, onSubmit, onKeyDown, onKeyUp, onScroll, onLoad

**Action types:** `navigation` (navigateTo/goToPage), `updateVariable` (setState), `customFunction` (runCode)

**Remove:** `remove-interaction(uuid, "Btn")` removes all handlers on that node, or specify `eventIndex` for a specific one.

## Mixin Application
Apply reusable style bundles to elements:
1. Check available mixins: `list-mixins()`
2. Apply: `apply-mixin(uuid, "Heading", "heading-styles")` — idempotent
3. Detach: `detach-mixin(uuid, "Heading", "heading-styles")`

## Node Animations
Attach CSS animations to elements:
1. Check available sequences: `list-animation-sequences()`
2. Attach: `add-node-animation(uuid, "Hero", "fade-in", duration: "1s", delay: "0.2s", timingFunction: "ease-out")`
3. Detach: `remove-node-animation(uuid, "Hero", "fade-in")` or omit sequenceRef to remove all

**Timing parameters:** duration, delay, timingFunction, iterationCount, direction (`normal`/`reverse`/`alternate`), fillMode (`none`/`forwards`/`backwards`/`both`)

## Image Assets
Set images from uploaded assets or URLs:
- From asset: `set-image(uuid, "HeroImg", assetRef: "hero-banner")`
- From URL: `set-image(uuid, "HeroImg", src: "https://example.com/img.jpg")`
- On non-img elements, sets as background image
- Supports `variant` for responsive images

Discover assets: `list-assets()` or `list-assets(typeFilter: "picture")`

## PlasmicElement Reference (for add-child)
Container: `{ "type": "vbox", "styles": { ... }, "children": [ ... ] }`
Text: `{ "type": "text", "value": "Hello", "tag": "h2", "styles": { ... } }`
Image: `{ "type": "img", "src": "https://...", "styles": { ... } }`
Button: `{ "type": "button", "value": "Click", "styles": { ... } }`
Input: `{ "type": "input", "attrs": { "placeholder": "..." } }`
Component: `{ "type": "component", "name": "Card", "props": { "title": "My Card" }, "children": [...] }`

Valid types: `img`, `text`, `box`, `vbox`, `hbox`, `page-section`, `button`, `input`, `password`, `textarea`, `component`, `default-component`

## Variant Editing Workflow
1. Call `list-variants(componentUuid)` to see available variants.
2. Identify variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover").
3. **If it doesn't exist**, create it:
   - Interactive states: `create-style-variant(uuid, ":hover")`
   - Custom groups: `create-variant-group(uuid, "Size", "single", ["Small", "Medium", "Large"])`
4. Pass `variant` to any edit tool: `update-styles(uuid, "Title", { "fontSize": "24px" }, variant: "Mobile")`
5. Omit `variant` to edit the base (default).

## Edge Case Handling
- **Ambiguous node**: Show all matches with UUIDs, ask to clarify.
- **Non-existent node**: Show tree outline via `get-component-summary`, suggest correct names.
- **Unknown variant**: Call `list-variants` to show available options.
- **Regret**: Suggest `undo`.

## User's Request
$ARGUMENTS
