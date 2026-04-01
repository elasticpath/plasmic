You are editing an existing page or component in a Plasmic project.

## Available Tools

### Inspection (read before edit)
- `inspect({ action: "summary", componentUuid, maxDepth: 2, format: "concise" })` — Compact outline (~2KB). **Start here** to orient.
- `inspect({ action: "node", componentUuid, nodeRef })` — Full details for one node. **Use to inspect before/after editing.**
- `inspect({ action: "subtree", componentUuid, nodeRef, maxDepth: 2 })` — Targeted branch when you need a section's children.
- `inspect({ action: "tree", componentUuid, maxDepth: 3 })` — Full tree (large). **Last resort** — always set maxDepth.
- `inspect({ action: "export", componentUuid })` — Write to temp file. Use Read tool to inspect.
- `variant({ action: "list", componentUuid })` — All variants: global, component, style.
- `component({ action: "list-props", componentUuid })` — Component parameters.
- `component({ action: "list-states", componentUuid })` — State variables.
- `data({ action: "list-queries", componentUuid })` — Data queries.
- `interaction({ action: "list", componentUuid, nodeRef })` — Event handlers on a specific node.
- `design({ action: "list-mixins" })` — Available reusable style bundles.
- `design({ action: "list-animations" })` — Available @keyframes animations.
- `design({ action: "list-assets", assetType? })` — Available image assets.
- `design({ action: "list-tokens", tokenType? })` — Design tokens.

### Text & Content
- `node({ action: "update-text", componentUuid, nodeRef, text, variant?, dynamic?, fallback?, html? })` — Set text. `dynamic: true` for JS expressions.
- `node({ action: "update-rich-text", componentUuid, nodeRef, text, marks[], variant? })` — Formatted text with inline marks.

### Styles & Attributes
- `node({ action: "update-styles", componentUuid, nodeRef, styles, variant? })` — CSS styles. `token:TokenName` supported.
- `node({ action: "update-attrs", componentUuid, nodeRef, attrs, variant? })` — HTML/ARIA/data-* attributes.

### Structure
- `node({ action: "add", componentUuid, parentRef, child, position?, slot? })` — Insert element.
- `node({ action: "remove", componentUuid, nodeRef })` — Remove element.
- `node({ action: "move", componentUuid, nodeRef, newParentRef, position?, slot? })` — Move element.
- `node({ action: "clone", componentUuid, nodeRef, newName?, parentRef?, position?, slot? })` — Deep-clone node.
- `node({ action: "reorder", componentUuid, parentRef, childRefs[] })` — Reorder children.

### Visibility & Data Binding
- `node({ action: "set-visibility", componentUuid, nodeRef, visible, variant? })` — `true` (visible) / `false` (not rendered) / `"displayNone"` (CSS display:none).
- `data({ action: "set-data-cond", componentUuid, nodeRef, condition, variant? })` — JS conditional. `null` removes.
- `data({ action: "set-data-rep", componentUuid, nodeRef, collection, elementVariable?, indexVariable? })` — Repeat over collection. `null` removes.

### Images
- `node({ action: "set-image", componentUuid, nodeRef, src?, assetRef?, variant? })` — Set image from URL or uploaded asset.

### Interactions
- `interaction({ action: "add", componentUuid, nodeRef, event, actionName, args, condition?, interactionName? })` — Add event handler.
- `interaction({ action: "update", componentUuid, nodeRef, event, interactionIndex, actionName?, args?, condition?, interactionName? })` — Update existing handler.
- `interaction({ action: "remove", componentUuid, nodeRef, event, interactionIndex? })` — Remove handler(s). `event` required; omit `interactionIndex` to remove all for that event.

### Mixins (on nodes)
- `node({ action: "apply-mixin", componentUuid, nodeRef, mixinRef })` — Apply mixin to element.
- `node({ action: "detach-mixin", componentUuid, nodeRef, mixinRef })` — Remove mixin from element.

### Animations (on nodes)
- `node({ action: "add-animation", componentUuid, nodeRef, seqRef, duration?, delay?, timingFunction?, iterationCount?, direction?, fillMode?, playState? })` — Attach animation. `playState`: "paused" | "running".
- `node({ action: "remove-animation", componentUuid, nodeRef, seqRef?, animationIndex? })` — Detach animation.

### Variants
- `variant({ action: "create-style", componentUuid, selector, nodeRef? })` — Create :hover, :focus, etc. Also accepts code component selectors like `[data-selected]` when the component root is a registered code component with variants.
- `variant({ action: "create-group", componentUuid, name, type?, initialVariants? })` — Named group.
- `variant({ action: "rename", variantRef, newName, componentUuid? })` — Rename a component-level variant.
- `variant({ action: "remove", variantRef, componentUuid? })` — Remove a component-level variant.

### Management
- `component({ action: "rename", componentUuid, newName, newPath? })` — Rename.
- `component({ action: "extract", componentUuid, nodeRef, name })` — Extract subtree into a new reusable component.
- `component({ action: "update-page-meta", componentUuid, ... })` — Set SEO metadata.
- `inspect({ action: "page-meta", componentUuid })` — Read SEO metadata.
- `inspect({ action: "preview-url", componentUuid })` — Get local preview URL (`navigateUrl`) for visual verification via Playwright. Also returns `studioUrl` and `viewportPresets`.
- `component({ action: "delete", componentUuid, force? })` — Delete.
- `inspect({ action: "style-properties", filter? })` — Valid CSS property names.
- `project({ action: "begin-batch" })` / `project({ action: "end-batch" })` — Group edits into a single save.
- `project({ action: "undo" })` — Revert the last operation.
- `project({ action: "save" })` — Force save.
- `project({ action: "refresh" })` — Reload from server.

All edit tools accept `dryRun: true` to preview changes without persisting.

## Editing Workflow
1. If no project is active, set one up.
2. Call `inspect({ action: "summary", componentUuid, maxDepth: 2, format: "concise" })` to see the compact outline.
3. Identify the node(s) to modify. Use node names or UUIDs from the summary.
4. Call `inspect({ action: "node", componentUuid, nodeRef })` to see current styles/text before editing.
5. Choose the right tool for each edit (see sections below).
6. For 3+ edits, wrap in `project({ action: "begin-batch" })` / `project({ action: "end-batch" })`.
7. **Verify with targeted reads** — call `inspect({ action: "node", componentUuid, nodeRef })` on the edited node to confirm. Do NOT re-read the full tree after edits.
8. If a save conflict occurs (412), explain and suggest `project({ action: "refresh" })`.

**Verification rule**: After editing, always verify with `inspect.node` on the specific node you changed. Never use `inspect.tree` to confirm a single edit — it wastes thousands of context tokens to re-read an entire tree when you only need one node's state.

**Visual verification**: For style-heavy edits (layout changes, responsive work, design tasks), use the preview server to visually confirm results:
1. `inspect({ action: "preview-url", componentUuid })` → get `navigateUrl`
2. `browser_navigate({ url: navigateUrl })` → wait 8s → `browser_take_screenshot({ type: "png" })`
3. Actually examine the screenshot and compare against the intended result. If a reference was provided, screenshot that too for side-by-side comparison.

This is especially important when matching a reference design — structural inspection alone cannot catch visual regressions like wrong spacing, font weight, or color mismatches.

**Following truncation hints**: If any inspect response contains `truncated: true`, read the `hint` field and follow its guidance — typically call `inspect.subtree` with a deeper `nodeRef` or pass `maxDepth` to control depth.

## Node References
- **UUID**: exact match (from tree output)
- **Name**: node name (e.g., "Hero Title")
- **Path**: dot-separated (e.g., "HeroSection.Title")
- **Content**: `~` prefix for text match (e.g., "~Hello World" — case-insensitive substring)

## Style Property Reference
Use camelCase CSS: `fontSize`, `backgroundColor`, `borderRadius`, etc.

**Shorthand expansion:** `border: "1px solid #ccc"` → 12 longhands. `borderTop: "2px dashed red"` → 3 longhands. `outline` similarly expands.

**Design tokens:** `{ "color": "token:Brand Primary" }`. Call `design({ action: "list-tokens" })` to discover available tokens.

**Discover valid properties:** `inspect({ action: "style-properties", filter: "border" })`.

## HTML Attribute Editing
- Static: `{ "href": "/home", "disabled": true, "data-testid": "hero" }`
- Dynamic: `{ "href": "$ctx.url" }` or `{ "href": "{{$ctx.url}}" }`
- Remove: `{ "href": null }`
- ARIA: `{ "aria-label": "Close", "role": "button" }`
- Event handler attributes (`onclick`, etc.) are rejected — use `interaction({ action: "add", ... })` instead.

## Dynamic Text Bindings
Use `node({ action: "update-text", ... })` with `dynamic: true` to bind text to data:
- Basic: `node({ action: "update-text", componentUuid: uuid, nodeRef: "Title", text: "$ctx.product.name", dynamic: true })`
- With fallback: `node({ action: "update-text", componentUuid: uuid, nodeRef: "Title", text: "$ctx.product.name", dynamic: true, fallback: "Untitled" })`
- HTML: `node({ action: "update-text", componentUuid: uuid, nodeRef: "Body", text: "$ctx.content", dynamic: true, html: true })`
- Back to static: `node({ action: "update-text", componentUuid: uuid, nodeRef: "Title", text: "Static text" })` (omit `dynamic`)

Dynamic text shows as `{ "text": "$ctx.product.name", "dynamic": true, "fallback": "..." }` in tree output.

## Rich Text Formatting
Use `node({ action: "update-rich-text", ... })` to set text with inline formatting marks:
```
node({ action: "update-rich-text", componentUuid, nodeRef, text: "Hello bold world", marks: [
  { "type": "bold", "start": 6, "end": 10 }
]})
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
- Basic: `node({ action: "clone", componentUuid, nodeRef: "Card" })` — creates "Card (copy)" as next sibling
- Custom name: `node({ action: "clone", componentUuid, nodeRef: "Card", newName: "CardAlt" })`
- Different parent: `node({ action: "clone", componentUuid, nodeRef: "Card", parentRef: "OtherSection", position: "first" })`
- Into slot: `node({ action: "clone", componentUuid, nodeRef: "Card", parentRef: "LayoutInstance", slot: "sidebar" })`
- All styles, text, variant settings, slot overrides are deep-cloned with new UUIDs

## Slot Content Targeting
Use `slot` on `node({ action: "add", ... })`, `node({ action: "move", ... })`, or `node({ action: "clone", ... })` to target named slots on component instances:
- Default slot: `node({ action: "add", componentUuid: uuid, parentRef: "CardInstance", child, slot: "children" })` — or just omit `slot`
- Named slot: `node({ action: "add", componentUuid: uuid, parentRef: "CardInstance", child, slot: "icon" })`
- Move into slot: `node({ action: "move", componentUuid: uuid, nodeRef: "MyNode", newParentRef: "CardInstance", slot: "footer" })`
- `slot` only works when target is a TplComponent; using it on a TplTag throws an error

## Reorder Children
Reorder children within a container by providing refs in desired order:
```
node({ action: "reorder", componentUuid, parentRef: "CardGrid", childRefs: ["Card3", "Card1", "Card2"] })
```
Partial lists supported — unlisted children are appended at the end.

## Visibility & Conditional Rendering
Control element visibility per variant:
- Hide completely (not rendered): `node({ action: "set-visibility", componentUuid: uuid, nodeRef: "Sidebar", visible: false })`
- Hide with CSS (display:none): `node({ action: "set-visibility", componentUuid: uuid, nodeRef: "Sidebar", visible: "displayNone" })`
- Show: `node({ action: "set-visibility", componentUuid: uuid, nodeRef: "Sidebar", visible: true })`

Attach JS conditional expressions:
- Show only if logged in: `data({ action: "set-data-cond", componentUuid: uuid, nodeRef: "AdminPanel", condition: "$ctx.user.isLoggedIn" })`
- Show if non-empty: `data({ action: "set-data-cond", componentUuid: uuid, nodeRef: "Results", condition: "$queries.search.data.length > 0" })`
- Remove condition: `data({ action: "set-data-cond", componentUuid: uuid, nodeRef: "AdminPanel", condition: null })`

Both support `variant` parameter for responsive/variant-specific visibility.

Tree output shows `visibility` and `dataCond` fields on nodes when set.

## Data Repetition (Collection Rendering)
Repeat an element for each item in a collection:
```
data({ action: "set-data-rep", componentUuid, nodeRef: "ProductCard", collection: "$queries.products.data" })
```
- Default loop variables: `currentItem` (element) and `currentIndex` (index)
- Custom names: `data({ action: "set-data-rep", componentUuid: uuid, nodeRef: "Row", collection: "$ctx.items", elementVariable: "item", indexVariable: "i" })`
- Remove: `data({ action: "set-data-rep", componentUuid: uuid, nodeRef: "ProductCard", collection: null })`

Inside repeated elements, use loop variables in dynamic text and conditions:
- `node({ action: "update-text", componentUuid: uuid, nodeRef: "ProductName", text: "$ctx.currentItem.name", dynamic: true })`
- `data({ action: "set-data-cond", componentUuid: uuid, nodeRef: "Badge", condition: "$ctx.currentItem.isNew" })`

Tree output shows `dataRep` field with `{ collection, elementVariable, indexVariable }`.

## Interactions & Event Handlers
Add interactive behavior to elements:

**Navigation:** Navigate to URL on click:
```
interaction({ action: "add", componentUuid: uuid, nodeRef: "NavLink", event: "onClick", actionName: "navigation", args: { destination: "'/about'" } })
```

**Update state:** Increment a counter:
```
interaction({ action: "add", componentUuid: uuid, nodeRef: "PlusBtn", event: "onClick", actionName: "updateVariable", args: {
  variable: "counter", operation: "newValue", value: "$state.counter + 1"
}})
```

**Custom code:** Run arbitrary JS:
```
interaction({ action: "add", componentUuid: uuid, nodeRef: "LogBtn", event: "onClick", actionName: "customFunction", args: { code: "console.log('clicked')" } })
```

**Conditional interactions:** Only fire when condition is met:
```
interaction({ action: "add", componentUuid: uuid, nodeRef: "Btn", event: "onClick", actionName: "navigation", args: { destination: "'/dashboard'" }, condition: "$state.isValid" })
```

**Supported events:** onClick, onDoubleClick, onMouseEnter, onMouseLeave, onFocus, onBlur, onChange, onSubmit, onKeyDown, onKeyUp, onScroll, onLoad

**Action types:** `navigation` (navigateTo/goToPage), `updateVariable` (setState), `customFunction` (runCode)

**Update:** `interaction({ action: "update", componentUuid: uuid, nodeRef: "Btn", event: "onClick", interactionIndex: 0, args: { destination: "'/new-path'" } })` modifies an existing handler.

**Remove:** `interaction({ action: "remove", componentUuid: uuid, nodeRef: "Btn", event: "onClick" })` removes all onClick handlers, or specify `interactionIndex` for a specific one.

## Mixin Application
Apply reusable style bundles to elements:
1. Check available mixins: `design({ action: "list-mixins" })`
2. Apply: `node({ action: "apply-mixin", componentUuid: uuid, nodeRef: "Heading", mixinRef: "heading-styles" })` — idempotent
3. Detach: `node({ action: "detach-mixin", componentUuid: uuid, nodeRef: "Heading", mixinRef: "heading-styles" })`

## Node Animations
Attach CSS animations to elements:
1. Check available sequences: `design({ action: "list-animations" })`
2. Attach: `node({ action: "add-animation", componentUuid: uuid, nodeRef: "Hero", seqRef: "fade-in", duration: "1s", delay: "0.2s", timingFunction: "ease-out" })`
3. Detach: `node({ action: "remove-animation", componentUuid: uuid, nodeRef: "Hero", seqRef: "fade-in" })` or omit seqRef to remove all

**Timing parameters:** duration, delay, timingFunction, iterationCount, direction (`normal`/`reverse`/`alternate`/`alternate-reverse`), fillMode (`none`/`forwards`/`backwards`/`both`), playState (`paused`/`running`)

## Image Assets
Set images from uploaded assets or URLs:
- From asset: `node({ action: "set-image", componentUuid: uuid, nodeRef: "HeroImg", assetRef: "hero-banner" })`
- From URL: `node({ action: "set-image", componentUuid: uuid, nodeRef: "HeroImg", src: "https://example.com/img.jpg" })`
- On non-img elements, sets as background image
- Supports `variant` for responsive images

Discover assets: `design({ action: "list-assets" })` or `design({ action: "list-assets", assetType: "picture" })`

## PlasmicElement Reference (for node add)
Container: `{ "type": "vbox", "styles": { ... }, "children": [ ... ] }`
Text: `{ "type": "text", "value": "Hello", "tag": "h2", "styles": { ... } }`
Image: `{ "type": "img", "src": "https://...", "styles": { ... } }`
Button: `{ "type": "button", "value": "Click", "styles": { ... } }`
Input: `{ "type": "input", "attrs": { "placeholder": "..." } }`
Component: `{ "type": "component", "name": "Card", "props": { "title": "My Card" }, "children": [...] }`

Valid types: `img`, `text`, `box`, `vbox`, `hbox`, `page-section`, `button`, `input`, `password`, `textarea`, `component`, `default-component`

## Variant Editing Workflow
1. Call `variant({ action: "list", componentUuid })` to see available variants.
2. Identify variant by name (e.g., "Mobile"), UUID, or selector (e.g., ":hover").
   - **Code component variants** (e.g., "Selected", "Pressed") appear in the `codeComponentVariants` array. Target them by key (e.g., `"selected"`), display name (e.g., `"Selected"`), or UUID.
   - Code component variants require dev host sync — if `codeComponentVariants` is empty, check that `project.set` returned `devHostSynced: true`. If not, ensure the dev host is running and call `project({ action: "refresh" })`.
3. **If it doesn't exist**, create it:
   - Interactive states: `variant({ action: "create-style", componentUuid: uuid, selector: ":hover" })`
   - Code component states: `variant({ action: "create-style", componentUuid: uuid, selector: "[data-selected]" })` — only works when the component root is a registered code component with that selector
   - Custom groups: `variant({ action: "create-group", componentUuid: uuid, name: "Size", type: "single", initialVariants: ["Small", "Medium", "Large"] })`
4. Pass `variant` to any edit tool: `node({ action: "update-styles", componentUuid: uuid, nodeRef: "Title", styles: { "fontSize": "24px" }, variant: "Mobile" })`
5. Omit `variant` to edit the base (default).

## Edge Case Handling
- **Ambiguous node**: Show all matches with UUIDs, ask to clarify.
- **Non-existent node**: Show tree outline via `inspect({ action: "summary", componentUuid, maxDepth: 2 })`, suggest correct names.
- **Unknown variant**: Call `variant({ action: "list", componentUuid })` to show available options.
- **Regret**: Suggest `project({ action: "undo" })`.

## User's Request
$ARGUMENTS
