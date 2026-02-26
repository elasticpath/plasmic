PlasmicElement pattern library for building pages and components. These are validated, server-compatible patterns that work with the `component({ action: "create-page" })` and `component({ action: "create" })` tools.

## CSS Rules

- **camelCase only**: `fontSize`, `backgroundColor`, `borderRadius` (not kebab-case)
- **Values are strings**: `"16px"`, `"#ff0000"`, `"1px solid #ccc"`
- **Border shorthand supported**: `border: "1px solid #ccc"` auto-expands to longhands. Also works: `borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `outline`.
- **No shorthand `transition`**: Use `transitionProperty`, `transitionDuration` separately
- **Use design tokens**: Call `design({ action: "list-tokens" })` first and use `token:TokenName` values instead of hardcoded colors/spacing (e.g., `"color": "token:Brand Primary"`)
- **Dynamic text**: Use `node({ action: "update-text" })` with `dynamic: true` to bind text to JS expressions like `$ctx.product.name`

## Valid Element Types

`img`, `text`, `box`, `vbox`, `hbox`, `page-section`, `button`, `input`, `password`, `textarea`, `component`, `default-component`

## Valid Container Tags

`div`, `section`, `article`, `nav`, `header`, `footer`, `aside`, `main`, `ul`, `ol`, `li`, `form`, `fieldset`

Note: For links, use `type: "text"` with `tag: "a"`. For buttons, use `type: "button"`.

## Valid Text Tags

`div` (default), `h1`-`h6`, `p`, `span`, `label`, `a` (with `href` in attrs), `blockquote`, `pre`, `code`

## Patterns

### Hero Section

```json
{
  "type": "page-section",
  "tag": "section",
  "styles": { "padding": "80px 20px", "backgroundColor": "#f8f9fa", "alignItems": "center", "gap": "24px" },
  "children": [
    { "type": "text", "tag": "h1", "value": "Page Title", "styles": { "fontSize": "48px", "fontWeight": "700", "textAlign": "center" } },
    { "type": "text", "tag": "p", "value": "Subtitle or description goes here.", "styles": { "fontSize": "18px", "color": "#666", "textAlign": "center", "maxWidth": "600px" } },
    { "type": "button", "value": "Get Started", "styles": { "padding": "12px 32px", "backgroundColor": "#0070f3", "color": "#ffffff", "borderRadius": "8px", "fontSize": "16px", "fontWeight": "600" } }
  ]
}
```

### Feature Grid (3-column)

```json
{
  "type": "page-section",
  "tag": "section",
  "styles": { "padding": "60px 20px", "alignItems": "center", "gap": "40px" },
  "children": [
    { "type": "text", "tag": "h2", "value": "Features", "styles": { "fontSize": "36px", "fontWeight": "700", "textAlign": "center" } },
    {
      "type": "hbox",
      "styles": { "gap": "24px", "maxWidth": "1200px", "width": "100%", "flexWrap": "wrap", "justifyContent": "center" },
      "children": [
        {
          "type": "vbox",
          "styles": { "flex": "1 1 300px", "padding": "32px", "backgroundColor": "#ffffff", "borderRadius": "12px", "gap": "16px", "alignItems": "center", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#e5e7eb" },
          "children": [
            { "type": "text", "tag": "h3", "value": "Feature One", "styles": { "fontSize": "20px", "fontWeight": "600" } },
            { "type": "text", "tag": "p", "value": "Description of the first feature.", "styles": { "fontSize": "16px", "color": "#666", "textAlign": "center" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "flex": "1 1 300px", "padding": "32px", "backgroundColor": "#ffffff", "borderRadius": "12px", "gap": "16px", "alignItems": "center", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#e5e7eb" },
          "children": [
            { "type": "text", "tag": "h3", "value": "Feature Two", "styles": { "fontSize": "20px", "fontWeight": "600" } },
            { "type": "text", "tag": "p", "value": "Description of the second feature.", "styles": { "fontSize": "16px", "color": "#666", "textAlign": "center" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "flex": "1 1 300px", "padding": "32px", "backgroundColor": "#ffffff", "borderRadius": "12px", "gap": "16px", "alignItems": "center", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#e5e7eb" },
          "children": [
            { "type": "text", "tag": "h3", "value": "Feature Three", "styles": { "fontSize": "20px", "fontWeight": "600" } },
            { "type": "text", "tag": "p", "value": "Description of the third feature.", "styles": { "fontSize": "16px", "color": "#666", "textAlign": "center" } }
          ]
        }
      ]
    }
  ]
}
```

### Card

Reusable card structure (use inside grids or lists):

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
        { "type": "text", "tag": "p", "value": "Card description goes here.", "styles": { "fontSize": "14px", "color": "#666" } }
      ]
    }
  ]
}
```

### Contact Form

```json
{
  "type": "page-section",
  "tag": "section",
  "styles": { "padding": "60px 20px", "alignItems": "center", "gap": "32px" },
  "children": [
    { "type": "text", "tag": "h2", "value": "Contact Us", "styles": { "fontSize": "36px", "fontWeight": "700", "textAlign": "center" } },
    {
      "type": "vbox",
      "tag": "form",
      "styles": { "gap": "16px", "maxWidth": "500px", "width": "100%" },
      "children": [
        {
          "type": "vbox",
          "styles": { "gap": "6px" },
          "children": [
            { "type": "text", "tag": "label", "value": "Name", "styles": { "fontSize": "14px", "fontWeight": "500" } },
            { "type": "input", "styles": { "padding": "10px 12px", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#d1d5db", "borderRadius": "6px", "fontSize": "16px" }, "attrs": { "placeholder": "Your name" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "gap": "6px" },
          "children": [
            { "type": "text", "tag": "label", "value": "Email", "styles": { "fontSize": "14px", "fontWeight": "500" } },
            { "type": "input", "styles": { "padding": "10px 12px", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#d1d5db", "borderRadius": "6px", "fontSize": "16px" }, "attrs": { "placeholder": "your@email.com" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "gap": "6px" },
          "children": [
            { "type": "text", "tag": "label", "value": "Message", "styles": { "fontSize": "14px", "fontWeight": "500" } },
            { "type": "textarea", "styles": { "padding": "10px 12px", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#d1d5db", "borderRadius": "6px", "fontSize": "16px", "minHeight": "120px" }, "attrs": { "placeholder": "Your message..." } }
          ]
        },
        { "type": "button", "value": "Send Message", "styles": { "padding": "12px 24px", "backgroundColor": "#0070f3", "color": "#ffffff", "borderRadius": "6px", "fontSize": "16px", "fontWeight": "600" } }
      ]
    }
  ]
}
```

### Navigation Header

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
        { "type": "text", "tag": "a", "value": "Contact", "styles": { "fontSize": "16px", "color": "#333" }, "attrs": { "href": "/contact" } },
        { "type": "button", "value": "Sign Up", "styles": { "padding": "8px 20px", "backgroundColor": "#0070f3", "color": "#ffffff", "borderRadius": "6px", "fontSize": "14px", "fontWeight": "600" } }
      ]
    }
  ]
}
```

### Footer

```json
{
  "type": "vbox",
  "tag": "footer",
  "styles": { "padding": "40px 24px", "backgroundColor": "#1a1a1a", "color": "#ffffff", "gap": "32px" },
  "children": [
    {
      "type": "hbox",
      "styles": { "justifyContent": "space-between", "flexWrap": "wrap", "gap": "32px", "maxWidth": "1200px", "width": "100%" },
      "children": [
        {
          "type": "vbox",
          "styles": { "gap": "12px" },
          "children": [
            { "type": "text", "tag": "h4", "value": "Company", "styles": { "fontSize": "16px", "fontWeight": "600" } },
            { "type": "text", "tag": "a", "value": "About", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/about" } },
            { "type": "text", "tag": "a", "value": "Careers", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/careers" } },
            { "type": "text", "tag": "a", "value": "Blog", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/blog" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "gap": "12px" },
          "children": [
            { "type": "text", "tag": "h4", "value": "Support", "styles": { "fontSize": "16px", "fontWeight": "600" } },
            { "type": "text", "tag": "a", "value": "Help Center", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/help" } },
            { "type": "text", "tag": "a", "value": "Contact", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/contact" } },
            { "type": "text", "tag": "a", "value": "Privacy", "styles": { "fontSize": "14px", "color": "#999" }, "attrs": { "href": "/privacy" } }
          ]
        }
      ]
    },
    { "type": "text", "tag": "p", "value": "2024 Company. All rights reserved.", "styles": { "fontSize": "14px", "color": "#666", "textAlign": "center" } }
  ]
}
```

### Pricing Table (3 tiers)

```json
{
  "type": "page-section",
  "tag": "section",
  "styles": { "padding": "60px 20px", "alignItems": "center", "gap": "40px" },
  "children": [
    { "type": "text", "tag": "h2", "value": "Pricing", "styles": { "fontSize": "36px", "fontWeight": "700", "textAlign": "center" } },
    {
      "type": "hbox",
      "styles": { "gap": "24px", "maxWidth": "1200px", "width": "100%", "flexWrap": "wrap", "justifyContent": "center", "alignItems": "stretch" },
      "children": [
        {
          "type": "vbox",
          "styles": { "flex": "1 1 280px", "maxWidth": "380px", "padding": "32px", "borderRadius": "12px", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#e5e7eb", "gap": "24px", "alignItems": "center" },
          "children": [
            { "type": "text", "tag": "h3", "value": "Starter", "styles": { "fontSize": "20px", "fontWeight": "600" } },
            { "type": "text", "tag": "p", "value": "$9/mo", "styles": { "fontSize": "36px", "fontWeight": "700" } },
            {
              "type": "vbox",
              "styles": { "gap": "8px", "alignItems": "center" },
              "children": [
                { "type": "text", "tag": "p", "value": "5 projects", "styles": { "fontSize": "14px", "color": "#666" } },
                { "type": "text", "tag": "p", "value": "Basic support", "styles": { "fontSize": "14px", "color": "#666" } },
                { "type": "text", "tag": "p", "value": "1 GB storage", "styles": { "fontSize": "14px", "color": "#666" } }
              ]
            },
            { "type": "button", "value": "Choose Starter", "styles": { "padding": "10px 24px", "backgroundColor": "#ffffff", "color": "#0070f3", "borderRadius": "6px", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#0070f3", "fontSize": "14px", "fontWeight": "600", "width": "100%" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "flex": "1 1 280px", "maxWidth": "380px", "padding": "32px", "borderRadius": "12px", "borderWidth": "2px", "borderStyle": "solid", "borderColor": "#0070f3", "gap": "24px", "alignItems": "center", "backgroundColor": "#f0f7ff" },
          "children": [
            { "type": "text", "tag": "h3", "value": "Pro", "styles": { "fontSize": "20px", "fontWeight": "600" } },
            { "type": "text", "tag": "p", "value": "$29/mo", "styles": { "fontSize": "36px", "fontWeight": "700" } },
            {
              "type": "vbox",
              "styles": { "gap": "8px", "alignItems": "center" },
              "children": [
                { "type": "text", "tag": "p", "value": "Unlimited projects", "styles": { "fontSize": "14px", "color": "#666" } },
                { "type": "text", "tag": "p", "value": "Priority support", "styles": { "fontSize": "14px", "color": "#666" } },
                { "type": "text", "tag": "p", "value": "10 GB storage", "styles": { "fontSize": "14px", "color": "#666" } }
              ]
            },
            { "type": "button", "value": "Choose Pro", "styles": { "padding": "10px 24px", "backgroundColor": "#0070f3", "color": "#ffffff", "borderRadius": "6px", "fontSize": "14px", "fontWeight": "600", "width": "100%" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "flex": "1 1 280px", "maxWidth": "380px", "padding": "32px", "borderRadius": "12px", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#e5e7eb", "gap": "24px", "alignItems": "center" },
          "children": [
            { "type": "text", "tag": "h3", "value": "Enterprise", "styles": { "fontSize": "20px", "fontWeight": "600" } },
            { "type": "text", "tag": "p", "value": "Custom", "styles": { "fontSize": "36px", "fontWeight": "700" } },
            {
              "type": "vbox",
              "styles": { "gap": "8px", "alignItems": "center" },
              "children": [
                { "type": "text", "tag": "p", "value": "Everything in Pro", "styles": { "fontSize": "14px", "color": "#666" } },
                { "type": "text", "tag": "p", "value": "Dedicated support", "styles": { "fontSize": "14px", "color": "#666" } },
                { "type": "text", "tag": "p", "value": "Unlimited storage", "styles": { "fontSize": "14px", "color": "#666" } }
              ]
            },
            { "type": "button", "value": "Contact Sales", "styles": { "padding": "10px 24px", "backgroundColor": "#ffffff", "color": "#0070f3", "borderRadius": "6px", "borderWidth": "1px", "borderStyle": "solid", "borderColor": "#0070f3", "fontSize": "14px", "fontWeight": "600", "width": "100%" } }
          ]
        }
      ]
    }
  ]
}
```

### Testimonial Section

```json
{
  "type": "page-section",
  "tag": "section",
  "styles": { "padding": "60px 20px", "backgroundColor": "#f8f9fa", "alignItems": "center", "gap": "40px" },
  "children": [
    { "type": "text", "tag": "h2", "value": "What Our Customers Say", "styles": { "fontSize": "36px", "fontWeight": "700", "textAlign": "center" } },
    {
      "type": "hbox",
      "styles": { "gap": "24px", "maxWidth": "1000px", "flexWrap": "wrap", "justifyContent": "center" },
      "children": [
        {
          "type": "vbox",
          "styles": { "flex": "1 1 280px", "padding": "24px", "backgroundColor": "#ffffff", "borderRadius": "12px", "gap": "16px" },
          "children": [
            { "type": "text", "tag": "p", "value": "\"This product completely transformed how we work. Highly recommended.\"", "styles": { "fontSize": "16px", "fontStyle": "italic", "color": "#333" } },
            { "type": "text", "tag": "p", "value": "— Jane Smith, CEO", "styles": { "fontSize": "14px", "fontWeight": "600", "color": "#666" } }
          ]
        },
        {
          "type": "vbox",
          "styles": { "flex": "1 1 280px", "padding": "24px", "backgroundColor": "#ffffff", "borderRadius": "12px", "gap": "16px" },
          "children": [
            { "type": "text", "tag": "p", "value": "\"The best tool we've ever used. It saves us hours every week.\"", "styles": { "fontSize": "16px", "fontStyle": "italic", "color": "#333" } },
            { "type": "text", "tag": "p", "value": "— John Doe, CTO", "styles": { "fontSize": "14px", "fontWeight": "600", "color": "#666" } }
          ]
        }
      ]
    }
  ]
}
```

### Call to Action (CTA) Section

```json
{
  "type": "page-section",
  "tag": "section",
  "styles": { "padding": "80px 20px", "backgroundColor": "#0070f3", "alignItems": "center", "gap": "24px" },
  "children": [
    { "type": "text", "tag": "h2", "value": "Ready to Get Started?", "styles": { "fontSize": "36px", "fontWeight": "700", "color": "#ffffff", "textAlign": "center" } },
    { "type": "text", "tag": "p", "value": "Join thousands of teams already using our platform.", "styles": { "fontSize": "18px", "color": "#e0e7ff", "textAlign": "center" } },
    {
      "type": "hbox",
      "styles": { "gap": "16px" },
      "children": [
        { "type": "button", "value": "Start Free Trial", "styles": { "padding": "12px 32px", "backgroundColor": "#ffffff", "color": "#0070f3", "borderRadius": "8px", "fontSize": "16px", "fontWeight": "600" } },
        { "type": "button", "value": "Learn More", "styles": { "padding": "12px 32px", "backgroundColor": "transparent", "color": "#ffffff", "borderRadius": "8px", "borderWidth": "2px", "borderStyle": "solid", "borderColor": "#ffffff", "fontSize": "16px", "fontWeight": "600" } }
      ]
    }
  ]
}
```

### Image Gallery (2x2 grid)

```json
{
  "type": "page-section",
  "tag": "section",
  "styles": { "padding": "60px 20px", "alignItems": "center", "gap": "32px" },
  "children": [
    { "type": "text", "tag": "h2", "value": "Gallery", "styles": { "fontSize": "36px", "fontWeight": "700", "textAlign": "center" } },
    {
      "type": "hbox",
      "styles": { "gap": "16px", "maxWidth": "800px", "width": "100%", "flexWrap": "wrap" },
      "children": [
        { "type": "img", "src": "https://placehold.co/400x300", "styles": { "flex": "1 1 45%", "height": "300px", "objectFit": "cover", "borderRadius": "8px" }, "attrs": { "alt": "Gallery image 1" } },
        { "type": "img", "src": "https://placehold.co/400x300", "styles": { "flex": "1 1 45%", "height": "300px", "objectFit": "cover", "borderRadius": "8px" }, "attrs": { "alt": "Gallery image 2" } },
        { "type": "img", "src": "https://placehold.co/400x300", "styles": { "flex": "1 1 45%", "height": "300px", "objectFit": "cover", "borderRadius": "8px" }, "attrs": { "alt": "Gallery image 3" } },
        { "type": "img", "src": "https://placehold.co/400x300", "styles": { "flex": "1 1 45%", "height": "300px", "objectFit": "cover", "borderRadius": "8px" }, "attrs": { "alt": "Gallery image 4" } }
      ]
    }
  ]
}
```

## Composing Full Pages

Build pages by wrapping patterns in a root `vbox`:

```json
{
  "type": "vbox",
  "styles": { "width": "100%" },
  "children": [
    { "...navigation header pattern..." },
    { "...hero section pattern..." },
    { "...feature grid pattern..." },
    { "...testimonial section pattern..." },
    { "...CTA section pattern..." },
    { "...footer pattern..." }
  ]
}
```

Alternate section backgrounds (`#ffffff` / `#f8f9fa`) for visual rhythm. Use consistent spacing: `60px 20px` for standard sections, `80px 20px` for emphasis.

## Referencing Existing Components

If the project has reusable components (found via `component({ action: "list" })`), reference them by name or UUID:

```json
{
  "type": "component",
  "name": "ProductCard",
  "props": { "title": "Widget", "price": "$19.99" }
}
```

With slot children (content passed into the component's default "children" slot):

```json
{
  "type": "component",
  "name": "Card",
  "children": [
    { "type": "text", "value": "Card title", "tag": "h3" },
    { "type": "text", "value": "Card description" }
  ]
}
```

**Default components** use `kind` instead of `name` to reference built-in Plasmic components:

```json
{
  "type": "default-component",
  "kind": "Button",
  "props": { "children": "Click me" }
}
```

The `kind` field resolves the component by name or UUID, just like `name` on `type: "component"`. Use `default-component` when referencing Plasmic's built-in components (Button, etc.) by their kind identifier.

Works with both `node({ action: "add" })` (inserts into an existing page/component) and `component({ action: "create-page" })`/`component({ action: "create" })` (within the element tree body). Components from dependency packages are also resolved automatically.

Props must match the component's actual parameter names exactly (case-sensitive). Use `inspect({ action: "summary" })` to inspect a component's structure, then `inspect({ action: "node" })` for specific nodes. Use `inspect({ action: "tree" })` only when you need the full tree with all styles.

## Using Design Tokens in Styles

After calling `design({ action: "list-tokens" })`, reference tokens by name instead of hardcoding values:

```json
{
  "type": "text",
  "tag": "h1",
  "value": "Welcome",
  "styles": {
    "fontSize": "token:Heading Size",
    "color": "token:Brand Primary",
    "fontFamily": "token:Body Font"
  }
}
```

Token references are resolved to `var(--token-<uuid>)` internally. The tree reader shows both the resolved CSS value and the token name in a `tokenRefs` object.

## Using Semantic HTML Tags

Containers support semantic HTML tags for better accessibility and SEO:

```json
{
  "type": "page-section",
  "tag": "section",
  "children": [
    {
      "type": "hbox",
      "tag": "nav",
      "children": [
        { "type": "text", "tag": "a", "value": "Home", "attrs": { "href": "/" } }
      ]
    },
    {
      "type": "vbox",
      "tag": "article",
      "children": [
        { "type": "text", "tag": "h2", "value": "Article Title" },
        { "type": "text", "tag": "p", "value": "Article body..." }
      ]
    }
  ]
}
```

Valid container tags: `div`, `section`, `article`, `nav`, `header`, `footer`, `aside`, `main`, `ul`, `ol`, `li`, `form`, `fieldset`
Valid text tags: `div`, `h1`-`h6`, `p`, `span`, `label`, `a`, `blockquote`, `pre`, `code`

## Targeting Named Slots on Component Instances

When using `node({ action: "add" })` with a component instance as the parent, use the `slot` parameter to target a specific slot:

```
node({ action: "add", componentUuid, parentRef: "CardInstance", child, slot: "icon" })
```

If `slot` is omitted and the parent is a TplComponent, content goes to the `"children"` slot by default.

## Post-Creation Enhancement Recipes

After creating a page or component with `component({ action: "create-page" })`/`component({ action: "create" })`, use these tool sequences to add dynamic behavior. These use `/plasmic-edit` tools.

### Data-Driven Product Grid
Create a product grid that renders from a data query:
1. Create page with a card container and one template card
2. `data({ action: "add-query", uuid, name: "products", body: "await fetch('/api/products').then(r => r.json())" })`
3. `data({ action: "set-data-rep", uuid, nodeRef: "ProductCard", collection: "$queries.products.data" })` — repeat card for each product
4. `node({ action: "update-text", uuid, nodeRef: "CardTitle", text: "$ctx.currentItem.name", dynamic: true, fallback: "Product" })`
5. `node({ action: "update-text", uuid, nodeRef: "CardPrice", text: "$ctx.currentItem.price", dynamic: true })`
6. `node({ action: "set-image", uuid, nodeRef: "CardImage", src: "$ctx.currentItem.imageUrl" })` — dynamic image

### Interactive Counter
Add state and interactions to a button:
1. `component({ action: "add-state", uuid, name: "count", variableType: "number", accessType: "private", initVal: "0" })`
2. `node({ action: "update-text", uuid, nodeRef: "CountLabel", text: "$state.count", dynamic: true, fallback: "0" })`
3. `interaction({ action: "add", uuid, nodeRef: "IncrementBtn", trigger: "onClick", actionType: "updateVariable", args: { variable: "count", operation: "newValue", value: "$state.count + 1" } })`

### Conditional Sections
Show/hide content based on conditions:
1. `data({ action: "set-data-cond", uuid, nodeRef: "AdminPanel", dataCond: "$ctx.user.role === 'admin'" })` — admin-only section
2. `data({ action: "set-data-cond", uuid, nodeRef: "EmptyState", dataCond: "$queries.items.data.length === 0" })` — show when no data
3. `node({ action: "set-visibility", uuid, nodeRef: "DesktopNav", visibility: "notRendered", variant: "Mobile" })` — hide on mobile

### Navigation Links
Add click-to-navigate behavior:
1. `interaction({ action: "add", uuid, nodeRef: "AboutLink", trigger: "onClick", actionType: "navigation", args: { destination: "'/about'" } })`
2. `interaction({ action: "add", uuid, nodeRef: "LoginBtn", trigger: "onClick", actionType: "navigation", args: { destination: "'/login'" } })`

### Form with Validation State
Create a form with input tracking:
1. `component({ action: "add-state", uuid, name: "email", variableType: "text", accessType: "private", initVal: "''" })`
2. `component({ action: "add-state", uuid, name: "isValid", variableType: "boolean", accessType: "private", initVal: "false" })`
3. `interaction({ action: "add", uuid, nodeRef: "EmailInput", trigger: "onChange", actionType: "updateVariable", args: { variable: "email", operation: "newValue", value: "$event.target.value" } })`
4. `interaction({ action: "add", uuid, nodeRef: "SubmitBtn", trigger: "onClick", actionType: "customFunction", args: { code: "if ($state.isValid) { fetch('/api/submit', { method: 'POST', body: JSON.stringify({ email: $state.email }) }) }" } })`

### Rich Text Content
Apply inline formatting after creation:
1. `node({ action: "update-rich-text", uuid, nodeRef: "Intro", text: "Welcome to our amazing platform", marks: [{ type: "bold", start: 15, end: 22 }, { type: "italic", start: 23, end: 31 }] })`
2. `node({ action: "update-rich-text", uuid, nodeRef: "CTA", text: "Click here to get started", marks: [{ type: "link", start: 6, end: 10, href: "/signup" }] })`

### Animated Hero
Apply entrance animations:
1. `design({ action: "create-animation", name: "fade-in-up", keyframes: [{ offset: 0, styles: { opacity: "0", transform: "translateY(20px)" } }, { offset: 100, styles: { opacity: "1", transform: "translateY(0)" } }] })`
2. `node({ action: "add-animation", uuid, nodeRef: "HeroTitle", animationName: "fade-in-up", duration: "0.8s", timingFunction: "ease-out" })`
3. `node({ action: "add-animation", uuid, nodeRef: "HeroSubtitle", animationName: "fade-in-up", duration: "0.8s", delay: "0.2s", timingFunction: "ease-out" })`

## User's Request
$ARGUMENTS
