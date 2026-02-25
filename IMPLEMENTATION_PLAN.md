# Implementation Plan

*Prioritized backlog for plasmic-mcp features. Ordered by dependency graph and impact on the ultimate goal: Claude Code skills that create pages in Plasmic Studio from the terminal.*

---

## All Features Complete

All P1–P8 features and post-implementation skill updates are done. 640 tests passing.

## Completed (P1–P8)

| Priority | Feature | Tests |
|----------|---------|-------|
| P1 | Error Recovery & Resilience | 463 |
| P2 | Slot Override Traversal | 481 |
| P3 | Element Tags & HTML Attributes | 508 |
| P4 | Border Support & CSS Validation | 541 |
| P5 | Design Token References in Styles | 594 |
| P6 | Slot Content Targeting | 608 |
| P7 | Data Bindings (Dynamic Text) | 621 |
| P8 | Node Cloning | 640 |

## Post-Implementation: Skill Updates ✅ COMPLETE

All Claude Code skills updated to document P1–P8 capabilities:

- [x] **`.claude/commands/plasmic.md`** — Added `clone-child`, `update-attrs`, `list-style-properties` to tool list; added routing for dynamic text, token refs, slot targeting, node cloning, attribute editing, CSS property discovery
- [x] **`.claude/commands/plasmic-edit.md`** — Added `clone-child`, `update-attrs`, `list-style-properties` tools; new sections for Dynamic Text Bindings, Design Token References, Border Shorthand, HTML Attribute Editing, Node Cloning, Slot Content Targeting
- [x] **`.claude/commands/plasmic-patterns.md`** — Updated CSS rules (border shorthand now supported, token refs via `token:Name`); added sections for Design Tokens in Styles, Semantic HTML Tags, Named Slot Targeting
- [x] **`.claude/commands/plasmic-create-page.md`** — Updated CSS rules (border shorthand, token refs)
- [x] **`.claude/commands/plasmic-create-component.md`** — Updated CSS rules (border shorthand, token refs); added slot targeting examples
- [x] **`.claude/commands/plasmic-inspect.md`** — New section documenting tree output formats: dynamic text (`dynamic: true`, `fallback`), token references (`tokenRefs` object), slot override display (`type: "slot"` wrappers), HTML attributes

## Dependency Graph

```
Slot Override Traversal (P2) ✅ ──► Slot Targeting (P6) ✅

Element Tags & Attrs (P3) ✅ ──► Data Bindings (P7) ✅

Node Cloning (P8) ✅ ─── standalone
```
