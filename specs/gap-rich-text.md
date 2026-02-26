# Rich Text Formatting

## Jobs to Be Done
- As a Claude Code user writing body copy, I want to apply inline formatting (bold, italic, links) so that text content is properly styled
- As a Claude Code user, I want to insert inline links within text blocks so that text is navigable

## Background

Studio's `RichText` supports inline markers for bold, italic, links, and nested inline elements. Currently `update-text` creates plain `RawText` (static) or `ExprText` (dynamic) — no inline formatting.

WAB represents rich text as `RichText` with `markers: NodeMarker[]` and optional `ExprText` children. Each `NodeMarker` has `position`, `length`, and points to a styled inline element.

## Implementation

New action on the `node` domain tool.

### `node({ action: "update-rich-text" })`
- **Parameters**:
  - `componentUuid`, `nodeRef`
  - `richText` — structured rich text definition:
    ```json
    {
      "text": "Click here to learn more about our product.",
      "marks": [
        { "start": 6, "end": 10, "type": "link", "href": "/about" },
        { "start": 27, "end": 34, "type": "bold" },
        { "start": 35, "end": 43, "type": "italic" }
      ]
    }
    ```
  - `variant?`, `dryRun?`
- Mark types: `bold`, `italic`, `underline`, `code`, `link` (with `href`), `strikethrough`
- Overlapping marks are allowed (e.g., bold + italic on same range)

## Acceptance Criteria
- [x] Can set text with bold marks
- [x] Can set text with italic marks
- [x] Can set text with inline links (href)
- [x] Can set text with overlapping marks (bold + link on same range)
- [x] `inspect({ action: "node" })` output includes `marks` array when rich text has formatting
- [x] Existing `update-text` still works for plain text (no breaking change)
- [x] Undo support
- [x] Batch mode support
- [x] Integration test: set rich text with link → read back → verify marks
- [x] Integration test: set rich text with bold + italic → verify
- [x] Unit tests for mark validation, overlap handling

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Mark extends beyond text length | Error: "Mark end (50) exceeds text length (43)" |
| Empty marks array | Creates plain RawText (same as update-text) |
| Link mark without href | Error: "Link marks require 'href' property" |
| Mark with start >= end | Error: "Mark start must be less than end" |
| Node is not a text element | Error: "Rich text can only be set on text elements" |
| Dynamic text (ExprText) with marks | Error: "Rich text marks not supported on dynamic text. Use update-text with dynamic:true instead." |

## Out of Scope
- Block-level formatting (headings, lists within rich text — those are separate elements)
- Inline images within text
- Custom inline components
