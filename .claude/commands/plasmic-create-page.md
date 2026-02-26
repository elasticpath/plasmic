You are creating a new page in a Plasmic project.

## Available Tools
- `project({ action: "set", projectId })` — Load a project. Call first if no project is active.
- `project({ action: "list" })` — List accessible projects.
- `component({ action: "list" })` — List existing pages and components.
- `design({ action: "list-tokens", tokenType? })` — Get design tokens (colors, spacing, fonts). Use these values in styles for design system consistency.
- `inspect({ action: "summary", componentUuid })` — Compact outline of a component. Use to understand existing components before referencing them.
- `inspect({ action: "node", componentUuid, nodeRef })` — Full details for a single node in a component.
- `component({ action: "create-page", name, path, body })` — Create a page with a PlasmicElement tree.

## PlasmicElement Type Reference

A PlasmicElement is a recursive JSON structure. The `component({ action: "create-page" })` tool accepts this as the `body` parameter.

### Element Types

**Container (box/vbox/hbox/page-section):**
```json
{
  "type": "vbox",
  "styles": { "padding": "40px 20px", "gap": "24px" },
  "children": [ ...child elements... ]
}
```
- `type: "vbox"` — vertical stack (flex column)
- `type: "hbox"` — horizontal stack (flex row)
- `type: "box"` — basic flex container
- `type: "page-section"` — full-width page section
- `tag` defaults to `"div"`, can be `"section"`, `"article"`, `"nav"`, `"header"`, `"footer"`, `"aside"`, `"main"`, `"ul"`, `"ol"`, `"li"`, `"form"`, `"fieldset"`

**Text:**
```json
{
  "type": "text",
  "value": "Hello World",
  "tag": "h1",
  "styles": { "fontSize": "32px", "fontWeight": "700" }
}
```
- `tag` defaults to `"div"`, can be `"h1"`-`"h6"`, `"p"`, `"span"`, `"label"`, `"a"`, `"blockquote"`, `"pre"`, `"code"`
- `value` is the text content (plain string)

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

**Input:**
```json
{
  "type": "input",
  "styles": { "padding": "8px 12px", "border": "1px solid #ccc", "borderRadius": "4px" },
  "attrs": { "placeholder": "Enter text..." }
}
```

### CSS Properties
Styles use React CSSProperties format (camelCase):
- `fontSize` not `font-size`
- `backgroundColor` not `background-color`
- `borderRadius` not `border-radius`
- Values are strings: `"16px"`, `"#ff0000"`, `"1px solid #ccc"`

### Valid Element Types
`img`, `text`, `box`, `vbox`, `hbox`, `page-section`, `button`, `input`, `password`, `textarea`, `component`, `default-component`

### CSS Rules
- **camelCase only**: `fontSize`, `backgroundColor`, `borderRadius` (not kebab-case)
- **Border shorthand supported**: `border: "1px solid #ccc"` auto-expands to longhands. Also `borderTop`, `outline`, etc.
- **No shorthand `transition`**: Use `transitionProperty`, `transitionDuration` separately
- **Design token references**: Use `token:TokenName` as a style value (e.g., `"color": "token:Brand Primary"`) to reference the project's design tokens

### Common Page Pattern

**Page with hero and content sections:**
```json
{
  "type": "vbox",
  "styles": { "width": "100%" },
  "children": [
    {
      "type": "page-section",
      "styles": { "padding": "80px 20px", "backgroundColor": "#f8f9fa", "alignItems": "center" },
      "children": [
        { "type": "text", "tag": "h1", "value": "Page Title", "styles": { "fontSize": "48px", "fontWeight": "700", "textAlign": "center" } },
        { "type": "text", "tag": "p", "value": "Subtitle text.", "styles": { "fontSize": "18px", "color": "#666", "textAlign": "center", "maxWidth": "600px" } }
      ]
    },
    {
      "type": "page-section",
      "styles": { "padding": "60px 20px" },
      "children": []
    }
  ]
}
```

For more patterns (grids, cards, forms, pricing, testimonials, footers, navigation), see `/plasmic-patterns`.

## Post-Creation Enhancement

After creating the page, you can enhance it with these tools (delegate to `/plasmic-edit`):
- **Dynamic data**: Bind text to expressions with `node({ action: "update-text", dynamic: true })` or `node({ action: "update-rich-text" })` for formatted text
- **Visibility**: Conditionally show/hide sections with `node({ action: "set-visibility" })` or `data({ action: "set-data-cond" })`
- **Data repetition**: Repeat elements over collections with `data({ action: "set-data-rep" })` (e.g., product cards from `$queries.products.data`)
- **Interactions**: Add onClick handlers, navigation, state updates with `interaction({ action: "add" })`
- **Images**: Set images from uploaded assets with `node({ action: "set-image" })`
- **Animations**: Attach CSS animations with `node({ action: "add-animation" })`
- **Mixins**: Apply reusable style bundles with `node({ action: "apply-mixin" })`
- **State management**: Add component state with `component({ action: "add-state" })`, then reference in interactions and dynamic text
- **Data queries**: Add data sources with `data({ action: "add-query" })`, then use `$queries.name.data` in expressions
- **Component props**: Define parameters with `component({ action: "add-prop" })` for reusable components

## Instructions
1. If no project is active, call `project({ action: "list" })` and ask the user which project, then `project({ action: "set", projectId })`.
2. Call `component({ action: "list" })` to see existing pages (avoid path conflicts).
3. Call `design({ action: "list-tokens" })` to discover the project's design tokens. Use token values (colors, spacing, fonts) in styles instead of hardcoding values.
4. Based on the user's description, construct a PlasmicElement tree using the project's design tokens.
5. Choose a reasonable page name (PascalCase) and path (kebab-case with leading slash).
6. Call `component({ action: "create-page", name, path, body })` with the constructed tree.
7. Report the result. Note any warnings from the API.
8. If the user wants dynamic behavior (interactions, data binding, etc.), proceed with post-creation enhancement using `/plasmic-edit`.

## User's Request
$ARGUMENTS
