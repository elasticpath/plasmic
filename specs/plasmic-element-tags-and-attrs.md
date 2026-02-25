# Element Tag Types and HTML Attributes

## Jobs to Be Done
- As a Claude Code user, I want to create elements with specific HTML tags (button, h1, section, nav, img, span) so that I can build semantically correct pages
- As a Claude Code user, I want to set HTML/ARIA attributes (role, aria-label, data-*, id, href) so that my components are accessible and functional

## Background

### Element Tags
Currently `add-child` with container types (box, vbox, hbox) always creates a `<div>`. Only `text`, `img`, `button`, `input`, and `textarea` types map to their respective tags. The `plasmicElementToTpl()` function ignores any `tag` field on container elements.

### HTML/ARIA Attributes
There is no `update-attrs` tool. Attributes can only be set during `add-child` creation (for img src). Studio stores attributes in `VariantSetting.attrs` as expression objects (CustomCode for dynamic, literal for static).

## Acceptance Criteria

### Element Tags
- [ ] All PlasmicElement types accept an optional `tag` field that overrides the default HTML tag
- [ ] Container elements (box, vbox, hbox) support: `div`, `section`, `article`, `nav`, `header`, `footer`, `aside`, `main`, `ul`, `ol`, `li`, `form`, `fieldset`
- [ ] Text elements support: `div`, `p`, `span`, `h1`-`h6`, `label`, `a`, `blockquote`, `pre`, `code`
- [ ] Invalid tag names are rejected with a clear error listing valid options for that element type
- [ ] Tag is reflected in `get-component-tree` output (already shown as `tag` field)

### HTML/ARIA Attributes
- [ ] New `update-attrs` tool accepts `{ componentUuid, nodeRef, attrs: { key: value } }`
- [ ] Static string values are stored as literal expressions
- [ ] Dynamic values (prefixed with `$` or wrapped in `{{...}}`) are stored as CustomCode expressions
- [ ] Standard HTML attributes supported: `id`, `class`, `href`, `target`, `rel`, `title`, `tabIndex`, `type`, `name`, `placeholder`, `value`, `disabled`, `checked`
- [ ] ARIA attributes supported: `role`, `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-hidden`, `aria-expanded`, `aria-selected`, `aria-disabled`
- [ ] Data attributes supported: `data-*` (any name)
- [ ] Existing attributes can be read in `get-component-tree` / `get-node-details` output (already works)
- [ ] `update-attrs` supports variant targeting (same as update-styles)
- [ ] `update-attrs` supports dry-run mode
- [ ] Removing an attribute: pass `null` as value to delete it
- [ ] Integration test verifies attribute round-trip (set → read → verify)

## Happy Path
1. User calls `add-child` with `{ type: "box", tag: "section", styles: { padding: "16px" } }`
2. A `<section>` TplTag is created (not a `<div>`)
3. User calls `update-attrs` with `{ nodeRef: "uuid", attrs: { role: "navigation", "aria-label": "Main menu" } }`
4. Attributes are stored on the node's variant setting
5. `get-node-details` shows the attributes in output

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| `tag: "script"` or `tag: "style"` | Rejected — unsafe tags not allowed |
| `tag: "custom-element"` | Allowed — web component custom elements are valid |
| `attr: "onclick"` or `attr: "onload"` | Rejected — event handler attributes not allowed (use event handlers tool if/when it exists) |
| Empty string value for attribute | Allowed — renders as boolean attribute (e.g., `disabled=""`) |
| `href` on non-anchor tag | Allowed — user responsibility, no tag validation |
| Attribute name with special chars | Rejected unless valid HTML attribute syntax |

## Out of Scope
- Event handler attributes (onclick, onchange, etc.)
- SVG-specific attributes
- Changing an existing element's tag type (only settable at creation)
