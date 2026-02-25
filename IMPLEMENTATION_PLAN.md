# Implementation Plan

*Prioritized backlog for plasmic-mcp features. Ordered by dependency graph and impact on the ultimate goal: Claude Code skills that create pages in Plasmic Studio from the terminal.*

---

## Priority 7: Data Bindings ✅ COMPLETE
**Spec:** `specs/plasmic-data-bindings.md` (13 criteria — dynamic text implemented and tested)
**Status:** Dynamic text bindings implemented and tested. 621 tests passing.

**What was implemented:**
- [x] `update-text` — accepts `dynamic: true`, `fallback`, and `html` optional fields in `server.ts` schema
- [x] `edit-tools.ts` `updateText()` — when `dynamic: true`, creates `ExprText({ expr: CustomCode({ code: text, fallback }), html })` instead of `RawText`
- [x] Fallback support: optional `fallback` string wrapped in `CustomCode({ code: JSON.stringify(fallback) })` for null/undefined expression results
- [x] Static ↔ dynamic text conversion: updating with `dynamic: true` replaces RawText with ExprText; updating without `dynamic` replaces ExprText with RawText
- [x] Empty expression validation: `dynamic: true` with empty/whitespace text throws descriptive error
- [x] Container check updated to recognize ExprText (not just RawText) as text content — prevents false "container" errors on dynamic text nodes
- [x] `tree-reader.ts` `extractText()` — returns expression code for ExprText nodes with `dynamic: true` and optional `fallback` fields on TreeNode
- [x] CustomCode expressions displayed as-is (e.g., `$ctx.product.name`)
- [x] ObjectPath expressions displayed as dot notation (e.g., `["$ctx", "product", "name"]` → `$ctx.product.name`)
- [x] VarRef expressions displayed as `$variableName`
- [x] `extractExprValue()` updated to handle ObjectPath in attrs (dot notation display)
- [x] `ExprText`, `ObjectPath`, `VarRef` class declarations added to `wab.d.ts` and mock implementations in `__mocks__/wab-classes.ts`
- [x] `isKnownObjectPath` type guard added to both `wab.d.ts` and `__mocks__/wab-classes.ts`
- [x] `TreeNode` type extended with `dynamic?: boolean` and `fallback?: string` fields
- [x] 8 new edit-tools tests: dynamic ExprText creation, fallback, html:true, dynamic→static conversion, empty expression error, ExprText not treated as container, dynamic-to-dynamic replacement, UUID resolution
- [x] 7 tree-reader tests updated/added: ExprText with CustomCode, with fallback, ObjectPath dot notation, VarRef, unknown expr type, static RawText no dynamic flag, ObjectPath in attrs
- [x] 1 new server integration test: dynamic/fallback/html parameter passthrough

**Already working (from Priority 3):**
- [x] Component props in `add-child` support CustomCode for dynamic values via `props` field
- [x] `update-attrs` supports dynamic values via `$` prefix or `{{ }}` wrapper

**Key design decisions:**
- `extractText()` return type changed from `string | undefined` to `{ text, dynamic?, fallback? } | undefined` to carry dynamic metadata through the tree reader
- Fallback is stored as `CustomCode({ code: JSON.stringify(fallback) })` on the inner CustomCode's fallback field, matching how Studio stores fallbacks
- `html` parameter defaults to `false` (matching Studio's default behavior for ExprText)
- Existing tests with wrong ExprText mock structure (treating `html` as text content) corrected to use proper `{ expr, html }` structure

**Files modified:** `edit-tools.ts`, `server.ts`, `tree-reader.ts`, `types.ts`, `wab.d.ts`, `__mocks__/wab-classes.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`, `tree-reader.test.ts`

---

## Priority 8: Node Cloning
**Spec:** `specs/plasmic-node-cloning.md` (14 criteria)
**Why last:** Convenience feature for duplicating elements. Useful but can be approximated by reading a node's structure and adding a new child with the same properties.

**Implementation items:**
- [ ] New `clone-child` tool in `server.ts` — accepts `{ componentUuid, nodeRef, newName?, parentRef?, position? }`
- [ ] `edit-tools.ts` — implement `cloneChild()`: deep clone target node and all descendants
- [ ] Clone inserted as sibling immediately after original (or at specified `parentRef` + `position`)
- [ ] Cloned nodes get new UUIDs (not duplicates of originals)
- [ ] All variant settings (base + non-base) copied to clone
- [ ] Text content, styles, and slot override content preserved
- [ ] Cannot clone root node of component (error with explanation)
- [ ] Dry-run and batch mode support
- [ ] Return new root node's UUID
- [ ] Undo support: remove cloned subtree on undo
- [ ] Handle TplComponent instances with slot overrides in clone
- [ ] Unit tests: deep clone, UUID uniqueness, variant copy, slot override preservation
- [ ] Integration test: clone → verify structure → undo → verify removal

**Files to modify:** `edit-tools.ts`, `server.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`, `real-integration.test.ts`

---

## Post-Implementation: Skill Updates

After specs are implemented, the Claude Code skills need updating to document new capabilities:

- [ ] **`.claude/commands/plasmic.md`** — Add `clone-child` and `update-attrs` to tool routing; add routing for dynamic text, token refs
- [ ] **`.claude/commands/plasmic-edit.md`** — Major update: document `clone-child`, `update-attrs`, dynamic text, token references, slot targeting, border shorthand support
- [ ] **`.claude/commands/plasmic-patterns.md`** — Add examples using token refs (`token:Primary Blue`), dynamic text (`dynamic: true`), border shorthand, semantic HTML tags
- [ ] **`.claude/commands/plasmic-create-page.md`** — Add dynamic text and token ref examples
- [ ] **`.claude/commands/plasmic-create-component.md`** — Add slot children targeting examples
- [ ] **`.claude/commands/plasmic-inspect.md`** — Document dynamic text and token ref display in tree output

---

## Dependency Graph

```
Slot Override Traversal (P2) ✅ ──► Slot Targeting (P6) ✅

Element Tags & Attrs (P3) ✅ ──► Data Bindings (P7) ✅

Node Cloning (P8) ─── standalone
```

## Completed (P1–P7)

| Priority | Feature | Tests |
|----------|---------|-------|
| P1 | Error Recovery & Resilience | 463 |
| P2 | Slot Override Traversal | 481 |
| P3 | Element Tags & HTML Attributes | 508 |
| P4 | Border Support & CSS Validation | 541 |
| P5 | Design Token References in Styles | 594 |
| P6 | Slot Content Targeting | 608 |
| P7 | Data Bindings (Dynamic Text) | 621 |
