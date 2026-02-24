You are creating a new page in a Plasmic project.

## Available Tools
- `set-project(projectId)` — Load a project. Call first if no project is active.
- `list-projects()` — List accessible projects.
- `list-components()` — List existing pages and components.
- `get-tokens(type?)` — Get design tokens (colors, spacing, fonts). Use these values in styles for design system consistency.
- `create-page(name, path, body)` — Create a page with a PlasmicElement tree.

## PlasmicElement Type Reference

A PlasmicElement is a recursive JSON structure. The `create-page` tool accepts this as the `body` parameter.

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
- `tag` defaults to `"div"`, can be `"section"`, `"nav"`, `"header"`, `"footer"`, `"main"`, `"article"`, `"aside"`, `"ul"`, `"ol"`, `"li"`, `"form"`, `"a"`, `"button"`, etc.

**Text:**
```json
{
  "type": "text",
  "value": "Hello World",
  "tag": "h1",
  "styles": { "fontSize": "32px", "fontWeight": "700" }
}
```
- `tag` defaults to `"div"`, can be `"h1"`-`"h6"`, `"p"`, `"span"`, `"a"`, etc.
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
- **No shorthand `border`**: Use `borderWidth`, `borderStyle`, `borderColor` separately
- **No shorthand `transition`**: Use `transitionProperty`, `transitionDuration` separately

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

## Instructions
1. If no project is active, call `list-projects` and ask the user which project, then `set-project`.
2. Call `list-components` to see existing pages (avoid path conflicts).
3. Call `get-tokens` to discover the project's design tokens. Use token values (colors, spacing, fonts) in styles instead of hardcoding values.
4. Based on the user's description, construct a PlasmicElement tree using the project's design tokens.
5. Choose a reasonable page name (PascalCase) and path (kebab-case with leading slash).
6. Call `create-page` with the constructed tree.
7. Report the result. Note any warnings from the API.

## User's Request
$ARGUMENTS
