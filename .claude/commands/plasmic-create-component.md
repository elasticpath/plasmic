You are creating a new reusable component (not a page) in a Plasmic project.

## Available Tools
- `project({ action: "set", projectId })` — Load a project. Call first if no project is active.
- `project({ action: "list" })` — List accessible projects.
- `component({ action: "list" })` — List existing pages and components.
- `design({ action: "list-tokens", tokenType? })` — Get design tokens (colors, spacing, fonts). Use these values in styles for design system consistency.
- `inspect({ action: "summary", componentUuid, maxDepth: 2 })` — Compact outline (type, tag, name, uuid, childCount — no styles/text). **Use first** to understand structure before cloning, referencing, or verifying after creation.
- `inspect({ action: "node", componentUuid, nodeRef })` — Full details for a single node. Use after summary to drill into specific nodes.
- `inspect({ action: "subtree", componentUuid, nodeRef, maxDepth: 2 })` — Targeted branch from a specific node downward. Use to inspect a section.
- `inspect({ action: "tree", componentUuid, maxDepth: 3 })` — Full tree with styles/text. **Last resort** — always set maxDepth.
- `component({ action: "create", name, body })` — Create a reusable component with a PlasmicElement tree.
- `component({ action: "clone", sourceUuid, name, path? })` — Duplicate an existing component or page.

## When to Create vs Clone

**Create** when the developer wants a new component built from scratch:
- "make a card component", "create a hero section component"
- You build a PlasmicElement tree and pass it as `body`

**Clone** when the developer wants to copy an existing component:
- "duplicate the header", "copy the homepage as a starting point"
- Find the source UUID via `component({ action: "list" })`, then call `component({ action: "clone", ... })`
- If the clone should be a page, pass a `path`; otherwise omit `path` to create a plain component

## PlasmicElement Type Reference

Same as `/plasmic-create-page`. The `component({ action: "create", ... })` tool accepts a PlasmicElement tree as `body`.

### Element Types

**Container (box/vbox/hbox/page-section):**
```json
{
  "type": "vbox",
  "styles": { "padding": "40px 20px", "gap": "24px" },
  "children": [ ...child elements... ]
}
```

**Text:**
```json
{
  "type": "text",
  "value": "Hello World",
  "tag": "h1",
  "styles": { "fontSize": "32px", "fontWeight": "700" }
}
```

**Image:**
```json
{
  "type": "img",
  "src": "https://example.com/image.jpg",
  "styles": { "width": "100%", "objectFit": "cover" },
  "attrs": { "alt": "Description" }
}
```

**Button:**
```json
{
  "type": "button",
  "value": "Click Me",
  "styles": { "padding": "12px 24px", "backgroundColor": "#0070f3", "color": "#ffffff", "borderRadius": "8px" }
}
```

### CSS Rules
- **camelCase only**: `fontSize`, `backgroundColor`, `borderRadius` (not kebab-case)
- **Border shorthand supported**: `border: "1px solid #ccc"` auto-expands to longhands. Also `borderTop`, `outline`, etc.
- **No shorthand `transition`**: Use `transitionProperty`, `transitionDuration` separately
- **Design token references**: Use `token:TokenName` as a style value (e.g., `"color": "token:Brand Primary"`) to reference the project's design tokens

**Component instance (reference existing component):**
```json
{
  "type": "component",
  "name": "Button",
  "props": { "label": "Click me", "disabled": true },
  "children": [ ...slot content... ]
}
```

**Adding children to named slots after creation:**
Use `node({ action: "add", ... })` with the `slot` parameter to target a specific slot on a component instance:
```
node({ action: "add", componentUuid, parentRef: "CardInstance", child, slot: "icon" })
node({ action: "add", componentUuid, parentRef: "CardInstance", child, slot: "footer" })
```
Omitting `slot` defaults to the `"children"` slot. The `slot` parameter only works when the parent is a TplComponent.

### Valid Element Types
`img`, `text`, `box`, `vbox`, `hbox`, `page-section`, `button`, `input`, `password`, `textarea`, `component`, `default-component`

## Common Component Patterns

### Card Component
```json
{
  "type": "vbox",
  "styles": { "borderRadius": "12px", "overflow": "hidden", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#e5e7eb", "backgroundColor": "#ffffff" },
  "children": [
    { "type": "img", "src": "https://placehold.co/400x240", "styles": { "width": "100%", "height": "240px", "objectFit": "cover" }, "attrs": { "alt": "Card image" } },
    {
      "type": "vbox",
      "styles": { "padding": "24px", "gap": "12px" },
      "children": [
        { "type": "text", "tag": "h3", "value": "Card Title", "styles": { "fontSize": "20px", "fontWeight": "600" } },
        { "type": "text", "tag": "p", "value": "Card description.", "styles": { "fontSize": "14px", "color": "#666" } }
      ]
    }
  ]
}
```

### Header/Navbar Component
```json
{
  "type": "hbox",
  "tag": "nav",
  "styles": { "padding": "16px 24px", "justifyContent": "space-between", "alignItems": "center", "borderBottomWidth": "1px", "borderBottomStyle": "solid", "borderBottomColor": "#e5e7eb" },
  "children": [
    { "type": "text", "tag": "span", "value": "Brand", "styles": { "fontSize": "20px", "fontWeight": "700" } },
    {
      "type": "hbox",
      "styles": { "gap": "24px", "alignItems": "center" },
      "children": [
        { "type": "text", "tag": "a", "value": "Home", "styles": { "fontSize": "16px", "color": "#333" }, "attrs": { "href": "/" } },
        { "type": "text", "tag": "a", "value": "About", "styles": { "fontSize": "16px", "color": "#333" }, "attrs": { "href": "/about" } },
        { "type": "button", "value": "Sign Up", "styles": { "padding": "8px 20px", "backgroundColor": "#0070f3", "color": "#ffffff", "borderRadius": "6px", "fontSize": "14px", "fontWeight": "600" } }
      ]
    }
  ]
}
```

### Footer Component
```json
{
  "type": "vbox",
  "tag": "footer",
  "styles": { "padding": "40px 24px", "backgroundColor": "#1a1a1a", "color": "#ffffff", "gap": "32px" },
  "children": [
    {
      "type": "hbox",
      "styles": { "justifyContent": "space-between", "flexWrap": "wrap", "gap": "32px" },
      "children": [
        {
          "type": "vbox",
          "styles": { "gap": "12px" },
          "children": [
            { "type": "text", "tag": "h4", "value": "Company", "styles": { "fontSize": "16px", "fontWeight": "600" } },
            { "type": "text", "tag": "a", "value": "About", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/about" } },
            { "type": "text", "tag": "a", "value": "Blog", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/blog" } }
          ]
        }
      ]
    },
    { "type": "text", "tag": "p", "value": "2024 Company. All rights reserved.", "styles": { "fontSize": "14px", "color": "#666", "textAlign": "center" } }
  ]
}
```

For more patterns (grids, forms, pricing, testimonials, CTAs), see `/plasmic-patterns`.

## Post-Creation Enhancement

After creating the component, you can enhance it with these tools (delegate to `/plasmic-edit`):
- **Component props**: Define parameters with `component({ action: "add-prop", ... })` (text/number/boolean/object/href/eventHandler), then use `$props.propName` in dynamic text
- **State management**: Add component state with `component({ action: "add-state", ... })` (private/readonly/writable), then use `$state.stateName` in expressions
- **Interactions**: Add onClick/onChange/etc. handlers with `interaction({ action: "add", ... })` — navigate, update state, or run custom code
- **Dynamic data**: Bind text to expressions with `node({ action: "update-text", ... dynamic: true })` or `node({ action: "update-rich-text", ... })`
- **Visibility**: Conditionally show/hide elements with `node({ action: "set-visibility", ... })` or `data({ action: "set-data-cond", ... })`
- **Data repetition**: Repeat elements with `data({ action: "set-data-rep", ... })` (e.g., `$queries.products.data`)
- **Data queries**: Add data sources with `data({ action: "add-query", ... })`
- **Images**: Set images from assets with `node({ action: "set-image", ... })`
- **Animations**: Attach CSS animations with `node({ action: "add-animation", ... })`
- **Mixins**: Apply reusable style bundles with `node({ action: "apply-mixin", ... })`
- **Variant groups**: Add size/theme variants with `variant({ action: "create-group", ... })`

## Instructions
1. If no project is active, call `project({ action: "list" })` and ask the user which project, then `project({ action: "set", projectId })`.
2. Call `component({ action: "list" })` to see existing components (avoid name conflicts, find clone sources).
3. Call `design({ action: "list-tokens" })` to discover design tokens. Use token values in styles.
4. Determine whether to **create** (new from scratch) or **clone** (copy existing):
   - **Create**: Construct a PlasmicElement tree and call `component({ action: "create", name, body })`.
   - **Clone**: Find the source UUID and call `component({ action: "clone", sourceUuid, name })`. Add `path` only if the clone should be a page.
5. When cloning or referencing, inspect the source with `inspect({ action: "summary", componentUuid, maxDepth: 2 })` first, then `inspect({ action: "node", componentUuid, nodeRef })` for specific nodes — avoid loading the full tree unnecessarily.
6. Use PascalCase for component names (e.g., `HeroSection`, `ProductCard`).
7. **Verify with a summary** — call `inspect({ action: "summary", componentUuid, maxDepth: 2 })` on the new component to confirm structure. Do NOT use `inspect.tree` for verification.
8. Report the result. Note any warnings from the API.
9. If the user wants dynamic behavior (props, state, interactions, etc.), proceed with post-creation enhancement using `/plasmic-edit`.

## User's Request
$ARGUMENTS
