You are creating a new reusable component (not a page) in a Plasmic project.

## Available Tools
- `set-project(projectId)` — Load a project. Call first if no project is active.
- `list-projects()` — List accessible projects.
- `list-components()` — List existing pages and components.
- `get-tokens(type?)` — Get design tokens (colors, spacing, fonts). Use these values in styles for design system consistency.
- `get-component-summary(componentUuid)` — Compact outline of a component (type, tag, name, uuid, childCount — no styles/text). **Use this first** to understand structure before cloning or referencing.
- `get-node-details(componentUuid, nodeRef)` — Full details for a single node. Use after summary to drill into specific nodes.
- `get-component-tree(componentUuid, maxDepth?, excludeStyles?, summaryOnly?)` — Full tree with all styles/text. Use only when you need the complete structure.
- `get-subtree(componentUuid, nodeRef, maxDepth?, excludeStyles?)` — Full tree from a specific node downward.
- `create-component(name, body)` — Create a reusable component with a PlasmicElement tree.
- `clone-component(sourceUuid, name, path?)` — Duplicate an existing component or page.

## When to Create vs Clone

**Create** when the developer wants a new component built from scratch:
- "make a card component", "create a hero section component"
- You build a PlasmicElement tree and pass it as `body`

**Clone** when the developer wants to copy an existing component:
- "duplicate the header", "copy the homepage as a starting point"
- Find the source UUID via `list-components`, then call `clone-component`
- If the clone should be a page, pass a `path`; otherwise omit `path` to create a plain component

## PlasmicElement Type Reference

Same as `/plasmic-create-page`. The `create-component` tool accepts a PlasmicElement tree as `body`.

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
- **No shorthand `border`**: Use `borderWidth`, `borderStyle`, `borderColor` separately
- **No shorthand `transition`**: Use `transitionProperty`, `transitionDuration` separately

**Component instance (reference existing component):**
```json
{
  "type": "component",
  "name": "Button",
  "props": { "label": "Click me", "disabled": true },
  "children": [ ...slot content... ]
}
```

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

## Instructions
1. If no project is active, call `list-projects` and ask the user which project, then `set-project`.
2. Call `list-components` to see existing components (avoid name conflicts, find clone sources).
3. Call `get-tokens` to discover design tokens. Use token values in styles.
4. Determine whether to **create** (new from scratch) or **clone** (copy existing):
   - **Create**: Construct a PlasmicElement tree and call `create-component(name, body)`.
   - **Clone**: Find the source UUID and call `clone-component(sourceUuid, name)`. Add `path` only if the clone should be a page.
5. When cloning or referencing, inspect the source with `get-component-summary` first, then `get-node-details` for specific nodes — avoid loading the full tree unnecessarily.
6. Use PascalCase for component names (e.g., `HeroSection`, `ProductCard`).
7. Report the result. Note any warnings from the API.

## User's Request
$ARGUMENTS
