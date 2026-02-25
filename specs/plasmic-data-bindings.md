# Data Bindings

## Jobs to Be Done
- As a Claude Code user building dynamic pages, I want to bind text content to data expressions (e.g., `$ctx.currentProduct.name`) so that components display live data
- As a Claude Code user, I want to bind element visibility and other properties to dynamic expressions so that components respond to application state

## Background

Plasmic represents dynamic values using expression types:
- **RawText** — static text with optional markers (embedded elements)
- **ExprText** — dynamic text bound to a CustomCode or ObjectPath expression
- **CustomCode** — arbitrary JS expression string (e.g., `"$ctx.product.name"`)
- **ObjectPath** — structured data path (e.g., `["$ctx", "product", "name"]`)
- **VarRef** — reference to a component state variable

Studio creates dynamic text via:
```ts
vs.text = new ExprText({
  expr: new CustomCode({ code: "$ctx.product.name", fallback: null }),
  html: false,
});
```

Currently the MCP's `update-text` only sets `RawText`. Dynamic text shows as `"[dynamic text]"` in tree output (read-only).

## Acceptance Criteria

### Dynamic Text
- [ ] `update-text` accepts a new optional field `dynamic: true` (or `expression: true`) that creates an ExprText instead of RawText
- [ ] When `dynamic: true`, the `text` value is treated as a JavaScript expression string (e.g., `"$ctx.product.name"`)
- [ ] The expression is wrapped in `new ExprText({ expr: new CustomCode({ code: text, fallback: null }), html: false })`
- [ ] Optionally accept `fallback` string for when the expression evaluates to null/undefined
- [ ] `get-component-tree` / `get-node-details` shows dynamic text with the expression code, not just `"[dynamic text]"`
- [ ] Static text can be converted to dynamic and vice versa

### Dynamic Props (Component Instance Arguments)
- [ ] Component props in `add-child` already support CustomCode via `props` field — verify and document
- [ ] `update-attrs` (from element-tags-and-attrs spec) supports dynamic values via `$` prefix or `{{ }}` wrapper

### Reading Dynamic Content
- [ ] `get-component-tree` shows expression source code for ExprText nodes (e.g., `text: "$ctx.product.name"` with a `dynamic: true` marker)
- [ ] `get-node-details` shows the full expression including fallback value if present
- [ ] ObjectPath expressions are displayed in dot notation (e.g., `$ctx.product.name`)
- [ ] VarRef expressions show the variable name

## Happy Path
1. User calls `update-text` with `{ nodeRef: "uuid", text: "$ctx.product.name", dynamic: true }`
2. Node's text is set to ExprText with CustomCode expression
3. `get-node-details` on that node shows `{ text: "$ctx.product.name", dynamic: true }`
4. In Studio preview, the text displays the actual data value

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Invalid expression syntax (e.g., `$ctx.product[`) | Accept as-is — expression validation happens at render time in Studio |
| `dynamic: true` with empty string | Error: expression text cannot be empty |
| Converting dynamic text back to static | `update-text` with `dynamic: false` (default) replaces ExprText with RawText |
| Expression referencing undefined variable | Accepted — runtime error in Studio preview, fallback displayed |
| `fallback: "N/A"` provided | Stored as CustomCode fallback, shown when expression is null |
| HTML content in expression result | `html: false` by default; accept `html: true` option for rich text |

## Out of Scope
- Visual expression editor (that's Studio's job)
- Expression type-checking or validation
- Creating new state variables or data sources
- Event handler bindings (onClick, onChange)
- Conditional rendering / visibility expressions (future spec)
