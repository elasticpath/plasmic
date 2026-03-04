# Plasmic MCP Server — Developer Feature Reference

## Jobs to Be Done

- As a developer working on the MCP server, I want a single reference document that explains every MCP tool and action with enough context that I can understand the feature without prior Plasmic knowledge
- As a developer integrating with the MCP, I want concise, self-contained descriptions of each capability so I can build effective tool calls

## Acceptance Criteria

- [ ] New file at `packages/plasmic-mcp/FEATURE_REFERENCE.md`
- [ ] Covers all 8 domain tools and all 104 actions (103 existing + 1 new `update-props`)
- [ ] Each tool section includes: a concept explanation (what the underlying feature is and why it exists), list of actions with self-contained descriptions, key parameters
- [ ] Self-contained — a developer with zero Plasmic experience can understand every feature from the doc alone
- [ ] Includes a "Feature Gap" section noting known Studio features not yet in MCP
- [ ] Includes architecture overview (STRAP pattern, 8-tool consolidation)

## Document Structure

### 1. Architecture Overview

**What is this?** The Plasmic MCP server exposes a visual web builder's editing engine as programmatic tools. Instead of clicking in a GUI, you call tool actions to build pages, style elements, wire data, and manage design systems.

- **STRAP architecture**: 8 domain tools consolidating 104 actions. Each tool groups related actions under a single endpoint with an `action` discriminator field.
- **Transport**: JSON-RPC over MCP protocol (Model Context Protocol) — a standard for AI tool use.
- **Source**: `packages/plasmic-mcp/src/server.ts` (tool definitions + routing), `packages/plasmic-mcp/src/edit-tools.ts` (mutation logic)
- **Editing engine**: Embeds the WAB engine from `platform/wab/src/wab/` — the same code Plasmic Studio uses. Mutations go through the same code paths as the GUI.

**Core concepts you need to know:**
- **Project**: A container for pages and components. Must be loaded (`project.set`) before any editing.
- **Component**: A reusable UI building block. Pages are components with a URL route.
- **Element tree**: Every component has a tree of elements — like a DOM tree. Elements are either HTML tags (`TplTag`) or instances of other components (`TplComponent`).
- **Variant**: An alternative version of a component's styles/content. Used for responsive breakpoints (mobile/desktop), interaction states (hover/focus), or feature toggles (dark mode).
- **VariantSetting**: The styles, text, visibility, and prop overrides that apply when a specific variant is active.
- **Design token**: A named value (color, spacing, font) that can be referenced throughout the project for consistency.

### 2. Tool Reference — project

**Concept**: Every editing session starts by loading a project. The project tool manages the session lifecycle — loading, saving, batching multiple edits into a single save, and undoing mistakes.

| Action | What it does |
|--------|-------------|
| `set` | Loads a project into memory by its ID. **Required before calling any other tool.** Downloads the project data from the Plasmic server and initializes the editing engine. |
| `list` | Returns all projects accessible to the authenticated user, with their IDs and names. Use this to find a project ID before calling `set`. |
| `get-meta` | Returns project metadata: name, number of pages, number of components, and structural overview. Useful for orientation. |
| `save` | Force-saves all pending changes to the Plasmic server. Changes are auto-saved periodically, but this guarantees immediate persistence. |
| `refresh` | Discards all in-memory changes and reloads the project from the server. Use when someone else has made changes in Studio and you need the latest version. |
| `begin-batch` | Starts a batch editing session. All subsequent edits are accumulated in memory without triggering individual saves. Reduces server round-trips when making many changes. |
| `end-batch` | Commits all accumulated edits from a batch session as a single revision. The project is saved once with all changes applied atomically. |
| `undo` | Reverts the most recent edit operation. Works like Ctrl+Z in Studio. |

### 3. Tool Reference — inspect

**Concept**: The inspect tool lets you read the current state of any component without changing it. You can view the full element tree (every div, text block, and component instance with their styles), or zoom in on a single element. This is how you understand what's already built before making edits.

| Action | What it does |
|--------|-------------|
| `tree` | Returns the full element tree for a component, including each element's tag/type, styles, text content, and layout properties. This is the most detailed view — like viewing the DOM inspector in browser DevTools. |
| `summary` | Returns a compact outline of the element tree: just the type, tag, name, uuid, and child count for each node. Much smaller than `tree` — good for orientation before drilling into specific elements. |
| `node` | Returns full details for a single element identified by name, uuid, or path. Includes all styles, attributes, text, variant overrides, and slot contents. |
| `subtree` | Returns the tree from a specific element downward (element + all its descendants). Useful when a component is large and you only care about one section. |
| `export` | Writes the full tree JSON to a temporary file and returns the file path. For trees too large to return inline. |
| `style-properties` | Lists all valid CSS property names in camelCase format (e.g., `backgroundColor`, `borderRadius`). Use this to discover what style properties are available. |
| `preview-url` | Returns the preview URL (rendered page) and Studio URL (editing interface) for a component or page. |
| `page-meta` | Reads a page's SEO metadata: title, description, canonical URL, and Open Graph image. |

Key parameters: `componentUuid` (which component to inspect), `nodeRef` (specific element by name/uuid/path), `maxDepth` (limit tree depth), `format` (`concise` for ~70% token reduction)

### 4. Tool Reference — component

**Concept**: Components are the building blocks of a Plasmic project. A **page** is a component with a URL route (e.g., `/checkout`). A **component** is a reusable piece of UI (e.g., a button, card, or form). This tool manages their lifecycle and their **prop/state schemas** — the interface contract that defines what data a component accepts (props) and what data it tracks internally (state).

| Action | What it does |
|--------|-------------|
| `list` | Lists all pages and components in the project with their names, UUIDs, and types. |
| `create-page` | Creates a new page with a URL path and a body defined as a PlasmicElement tree (a JSON structure describing the element hierarchy). |
| `create` | Creates a new reusable component (not a page — no URL route). |
| `clone` | Duplicates an existing page or component, creating an independent copy. |
| `rename` | Changes a page's or component's name. For pages, optionally updates the URL path too. |
| `delete` | Removes a page or component. Use `force: true` to delete even if other components reference it. |
| `extract` | Takes a subtree of elements inside a component and extracts it into a new standalone component. The original elements are replaced with an instance of the new component. This is how you refactor repeated patterns into reusable pieces. |
| `convert-to-page` | Converts a component into a page by assigning it a URL route. |
| `convert-to-component` | Converts a page into a component by removing its URL route. |
| `update-page-meta` | Sets a page's SEO metadata: `<title>`, `<meta description>`, canonical URL, Open Graph image. |
| `list-props` | Lists all prop definitions on a component's schema — the named inputs that instances of this component accept (e.g., `label: string`, `onClick: function`). |
| `add-prop` | Adds a new prop to a component's schema. This defines the interface — instances can then receive values for this prop. |
| `update-prop` | Modifies a prop definition's type, default value, or description. |
| `remove-prop` | Removes a prop from the component schema. |
| `list-states` | Lists all state variables on a component. States are internal reactive values (e.g., `isOpen: boolean`, `count: number`) that the component tracks and can change at runtime. |
| `add-state` | Adds a new state variable with a type (text, number, boolean, array), access level (private, readonly, writable), and initial value. |
| `update-state` | Modifies a state variable's definition. |
| `remove-state` | Removes a state variable from the component. |

### 5. Tool Reference — node

**Concept**: Every component has a tree of **nodes** (elements). A node is either an HTML tag (`<div>`, `<button>`, `<img>` — called a **TplTag**) or an instance of another component (called a **TplComponent**). The node tool is the core editing tool — it's how you build and modify the actual UI: adding elements, styling them, setting text, wiring data, and controlling visibility.

| Action | What it does |
|--------|-------------|
| `add` | Inserts a new element into the tree. Can be an HTML tag (`type: "div"`), a component instance (`type: "component", component: "Button"`), or a text block. Supports setting initial props, styles, and slot content. |
| `remove` | Deletes an element and all its children from the tree. |
| `move` | Moves an element from its current parent to a different parent element, optionally at a specific position. |
| `clone` | Creates a copy of an element (and its children) within the same component. |
| `reorder` | Changes the order of children under a parent element. Pass an ordered array of child references. |
| `update-styles` | Sets CSS styles on an element using camelCase property names (e.g., `{ backgroundColor: "#ff0000", padding: "16px" }`). Styles can be set per-variant so an element looks different on mobile vs desktop, or on hover vs default. Supports design token references (e.g., `var(--token-xyz)`). |
| `update-text` | Sets the text content of a text element. Can be a plain string or a dynamic expression (e.g., `$ctx.params.title`) that evaluates at runtime. |
| `update-rich-text` | Sets text with inline formatting marks — bold, italic, underline, strikethrough, links, and inline code. Each mark specifies a character range and a format type. |
| `update-attrs` | Sets HTML attributes on an HTML tag element (TplTag only). Attributes like `id`, `class`, `aria-label`, `data-testid`, `href`, `target`, etc. Does **not** work on component instances — use `update-props` for those. |
| `update-props` | **NEW** — Sets or updates prop values on a **component instance** (TplComponent). This is the component equivalent of `update-attrs`. Supports literal values (`"hello"`, `42`, `true`), dynamic expression bindings (`$ctx.params.orderId`, `{{$queries.cart.data.id}}`), slot content (PlasmicElement trees for render props), and prop deletion (`null`). Can target specific variants. |
| `set-visibility` | Controls whether an element is visible. Options: `true` (visible), `false` (hidden but takes space), `"displayNone"` (hidden and removed from layout). Can be set per-variant — e.g., hide on mobile, show on desktop. |
| `set-image` | Sets the source of an image element. Can reference an uploaded asset by name/UUID, or use a raw URL. |
| `apply-mixin` | Applies a **mixin** (a saved bundle of styles) to an element. Mixins are like CSS classes — define styles once, apply to many elements. When the mixin changes, all elements using it update. |
| `detach-mixin` | Removes a mixin from an element, converting the mixin's styles into inline styles on the element. |
| `add-animation` | Applies a CSS `@keyframes` animation to an element. Configure duration, delay, timing function, iteration count, direction, and fill mode. |
| `remove-animation` | Removes an animation from an element. |

Key parameters: `componentUuid`, `nodeRef` (element by name/uuid/path/index), `parentRef`, `position` (`"first"`, `"last"`, or index), `variant`, `styles`, `attrs`, `props`, `text`, `marks`

### 6. Tool Reference — variant

**Concept**: A **variant** is an alternative version of how a component looks or behaves. Think of variants as conditional layers of overrides. There are several kinds:

- **Style variants** — triggered by CSS pseudo-classes like `:hover`, `:focus`, `:active`. They override styles when the user interacts with an element.
- **Component variant groups** — named categories like "Size" (small/medium/large) or "Theme" (light/dark) that instances can select.
- **Global variant groups** — project-wide toggles like dark mode, locale, or feature flags that affect all components.
- **Screen variants** — responsive breakpoints (e.g., "Mobile: max-width 768px") that activate based on viewport size.

When you set styles or visibility with a `variant` parameter, those overrides only apply when that variant is active.

| Action | What it does |
|--------|-------------|
| `list` | Lists all variants defined on a component, grouped by type (base, style, group, screen). |
| `create-style` | Creates a style variant triggered by a CSS pseudo-class. For example, creating a `:hover` variant lets you define styles that only apply on mouse hover. Can be scoped to a specific element. |
| `create-group` | Creates a named variant group with a type: `single` (only one active at a time, like a radio button), `multi` (multiple can be active, like checkboxes), or `toggle` (on/off). Initial variants can be provided. |
| `list-global-groups` | Lists all global variant groups in the project (e.g., "Dark Mode", "Locale"). |
| `create-global-group` | Creates a new global variant group that applies across all components. |
| `add-global` | Adds a new variant option to an existing global group (e.g., adding "French" to a "Locale" group). |
| `remove-global-group` | Deletes an entire global variant group and all its variants. |
| `rename-global` | Renames a global variant. |
| `create-screen` | Creates a responsive breakpoint variant. Specify `minWidth` and/or `maxWidth` in pixels. Styles set under this variant only apply at that viewport range. |
| `update-screen` | Changes the min/max width of an existing screen variant. |
| `rename` | Renames a variant (component-level or global). |
| `remove` | Deletes a single variant. |

### 7. Tool Reference — design

**Concept**: The design tool manages your project's **design system** — the shared visual language that keeps your UI consistent. It covers five areas:

**Tokens** — Named values that represent your design decisions. Instead of hardcoding `#3B82F6` everywhere, you create a token called "Primary Blue" and reference it. Change the token once, every usage updates. Token types: Color, Spacing, FontFamily, FontSize, Opacity, LineHeight.

| Action | What it does |
|--------|-------------|
| `list-tokens` | Lists all design tokens, optionally filtered by type (e.g., only Color tokens). |
| `create-token` | Creates a new token with a name, type, and value (e.g., name: "Primary", type: "Color", value: "#3B82F6"). |
| `update-token` | Changes a token's name or value. All elements referencing the token automatically reflect the change. |
| `remove-token` | Deletes a token. Elements referencing it fall back to the raw value. |
| `duplicate-token` | Creates a copy of a token (useful for creating variations like "Primary Light" from "Primary"). |

**Mixins** — Reusable bundles of CSS styles, like a saved preset. Define a mixin with padding, background, border-radius, etc., then apply it to multiple elements. Update the mixin, all elements update. Similar to CSS utility classes.

| Action | What it does |
|--------|-------------|
| `list-mixins` | Lists all style mixins in the project. |
| `create-mixin` | Creates a new mixin with a name and CSS styles (camelCase properties). |
| `update-mixin` | Modifies a mixin's name or styles. |
| `remove-mixin` | Deletes a mixin. Elements using it retain the styles as inline styles. |

**Animations** — CSS `@keyframes` definitions. Each animation is a sequence of keyframe stops at percentage points (0%, 50%, 100%) with CSS styles at each stop. Animations are defined here and applied to elements via `node.add-animation`.

| Action | What it does |
|--------|-------------|
| `list-animations` | Lists all animation sequences in the project. |
| `create-animation` | Creates a new animation with a name and keyframe stops (e.g., `[{ percentage: 0, styles: { opacity: "0" } }, { percentage: 100, styles: { opacity: "1" } }]`). |
| `update-animation` | Modifies an animation's name or keyframes. |
| `remove-animation` | Deletes an animation. Elements referencing it lose the animation. |

**Themes** — Typography presets. A theme defines default font styles for the entire project and optional per-tag overrides (e.g., `<h1>` gets 36px bold, `<p>` gets 16px regular). Only one theme is active at a time.

| Action | What it does |
|--------|-------------|
| `list-themes` | Lists all themes with their default styles and per-tag overrides. |
| `create-theme` | Creates a new theme with `defaultStyles` (base typography) and optional `themeStyles` (per-tag overrides like `{ selector: "h1", styles: { fontSize: "36px" } }`). |
| `update-theme` | Modifies a theme's default styles or tag overrides. |
| `remove-theme` | Deletes a theme. |
| `set-active-theme` | Sets which theme is currently active. The active theme's typography applies as the project-wide default. |

**Assets** — Images and icons uploaded to the project. Once uploaded, assets can be referenced by name in `node.set-image` instead of using raw URLs. Assets are optimized and served from Plasmic's CDN.

| Action | What it does |
|--------|-------------|
| `list-assets` | Lists all uploaded images and icons with their names, UUIDs, and types. |
| `upload-asset` | Uploads an image from a URL or inline data URI. Specify type (`picture` or `icon`) and optional dimensions. |
| `rename-asset` | Changes an asset's name. |
| `remove-asset` | Deletes an asset from the project. |

### 8. Tool Reference — data

**Concept**: The data tool manages how components connect to runtime data. This includes conditional rendering (show/hide based on data), looping (repeat elements for each item in a list), data fetching (queries), site-wide constants (data tokens), and A/B testing (splits).

| Action | What it does |
|--------|-------------|
| `set-data-cond` | Sets a JavaScript expression that controls whether an element renders. If the expression evaluates to falsy at runtime, the element and all its children are removed from the DOM. Example: `$ctx.user.isAdmin` to show admin-only UI. Pass `null` to remove the condition. |
| `set-data-rep` | Makes an element repeat for each item in a collection. You provide a JS expression for the collection (e.g., `$queries.products.data`), a variable name for each item (e.g., `currentProduct`), and an optional index variable. The element and its children are duplicated for each item at runtime. Pass `null` collection to remove repetition. |
| `list-queries` | Lists all data queries defined on a component. Queries fetch data that the component can reference in expressions. |
| `add-query` | Creates a new data query. Types: `dataQuery` (client-side fetch) or `serverQuery` (server-side, SSR-compatible). |
| `update-query` | Modifies a query's parameters or configuration. |
| `remove-query` | Deletes a query from the component. |
| `list-data-tokens` | Lists site-level data tokens — named JSON constants accessible everywhere via `$ctx.tokenName`. |
| `create-data-token` | Creates a site-wide JSON constant. Useful for configuration values, API endpoints, or shared data that multiple components need. |
| `update-data-token` | Changes a data token's value. |
| `remove-data-token` | Deletes a data token. |
| `list-splits` | Lists A/B tests and audience segments. Splits let you show different content to different users for experimentation or targeting. |
| `create-split` | Creates an experiment (random A/B split) or segment (condition-based targeting). Define slices with names, probabilities, or conditions. |
| `update-split` | Modifies a split's slices, probabilities, conditions, or status (new/running/stopped). |
| `remove-split` | Deletes a split. |
| `get-code-meta` | Returns metadata for registered code components — components defined in code (React) and registered with Plasmic for use in the visual builder. Shows their props, default values, and descriptions. |
| `list-functions` | Lists available functions that can be referenced in expressions and interactions. |

### 9. Tool Reference — interaction

**Concept**: Interactions are event handlers attached to elements — they define what happens when a user clicks, hovers, submits, or interacts with the page. Each interaction has a trigger event (e.g., `onClick`), an action to perform, and optional arguments.

| Action | What it does |
|--------|-------------|
| `list` | Lists all interactions on an element, showing their events, actions, arguments, and conditions. |
| `add` | Attaches a new event handler to an element. Specify the event (`onClick`, `onChange`, `onSubmit`, etc.) and one of three action types: **navigation** (go to a page or URL), **updateVariable** (change a state variable's value), or **customFunction** (run arbitrary JavaScript). Arguments vary by action type. |
| `update` | Modifies an existing interaction's action, arguments, or execution condition. |
| `remove` | Removes one or all interactions from an element. |

Supported action types:
- `navigation` — Navigate to a page (by component UUID) or external URL. Args: `destination`, `url`
- `updateVariable` — Mutate a component state variable. Args: `variable` (state ref), `operation` (set/toggle/increment/etc.), `value`
- `customFunction` — Execute arbitrary JavaScript. Args: `code` (JS expression)

### 10. Known Feature Gaps

Studio features not yet exposed in MCP (as of 2026-03-04):

| Gap | What it is | Impact |
|-----|-----------|--------|
| Arena/Frame management | The design canvas workspace in Studio where you arrange and preview multiple component frames | Low — only relevant for GUI workflows, not programmatic building |

### Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| `project.list` returns HTTP 500 | The MCP sends `?query=all` but the server's `parseQueryParams` (`util.ts:189`) runs `JSON.parse()` on every query param value, so it expects `?query="all"` (a JSON-encoded string). `JSON.parse("all")` throws `SyntaxError: Unexpected token 'a', "all" is not valid JSON`. Fix: change `api-client.ts:202` to send the value as a JSON-encoded string. | Use a known project ID directly with `project.set`. |

All major previously-reported gaps (visibility, interactions, state, rich text, props, mixins, tokens, animations, themes, assets, data queries, variants, splits) have been resolved.

## Out of Scope

- MCP transport/protocol specification (covered by the MCP spec itself)
- Tutorial or getting-started guide (separate concern)
- Code component registration guide (existing Plasmic docs)
