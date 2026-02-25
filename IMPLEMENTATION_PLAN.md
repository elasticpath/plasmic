# Implementation Plan

*Prioritized backlog for plasmic-mcp features. Ordered by dependency graph and impact on the ultimate goal: Claude Code skills that create pages in Plasmic Studio from the terminal.*

---

## Priority 6: Slot Content Targeting ✅ COMPLETE
**Spec:** `specs/plasmic-slot-targeting.md` (9 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 608 tests passing.

**What was implemented:**
- [x] `edit-tools.ts` `addChild()` — accepts new optional `slot` parameter; when parent is TplComponent, adds child to named slot's `RenderExpr.tpl[]`; defaults to "children" slot when `slot` omitted on TplComponent parents
- [x] New `Arg` + `RenderExpr` creation when no slot override exists yet (both mock classes and wab.d.ts declarations added)
- [x] Position support within slots: "first", "last" (default), and numeric index via `insertIntoArray()` helper
- [x] `findParent()` rewritten as recursive traversal that searches both `node.children` arrays AND `RenderExpr.tpl[]` arrays inside TplComponent slot overrides — enables `removeChild` and `moveChild` for slot content
- [x] `removeChild` now removes nodes from inside slot override content (uses `childrenArray` from updated `findParent`)
- [x] `moveChild` also uses `childrenArray` for consistent slot-aware removal
- [x] `server.ts` — `add-child` tool schema extended with `slot` field; response includes `slotName` when set
- [x] Error handling: "Slot X not found on component Y" with available slot list, "Component X has no slots", "Slot targeting only applies to component instances" (TplTag + slot), "contains a code expression, not renderable content" (non-RenderExpr slot)
- [x] Undo and batch mode support inherited from `saveOrAccumulate()`
- [x] 14 new tests: 9 addChild slot targeting (new Arg+RenderExpr, append to existing, position first/numeric, default children slot, explicit children, invalid slot name, no slots, TplTag+slot error, code expression error), 3 removeChild from slot override (direct removal, deeply nested, multiple children), 1 server integration (slot parameter passthrough)

**Key design decisions:**
- When `addChild` targets a TplComponent and `slot` is omitted, it defaults to "children" slot (consistent with how Studio handles default slot content)
- `findParent` was rewritten from flat iteration (`flattenTpls` + indexOf) to recursive walk, which correctly traverses both regular children and slot override tpl arrays at any depth
- `Arg` and `RenderExpr` constructors added to both `wab.d.ts` (type declarations) and `__mocks__/wab-classes.ts` (test mocks) so new slot overrides can be created programmatically
- `insertIntoArray()` extracted as a reusable helper for array position insertion, separate from `insertChild()` which sets parent pointers

**Files modified:** `edit-tools.ts`, `server.ts`, `wab.d.ts`, `__mocks__/wab-classes.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`

---

## Priority 7: Data Bindings
**Spec:** `specs/plasmic-data-bindings.md` (13 criteria)
**Depends on:** Priority 3 (Element Tags & Attrs — for dynamic attr values)
**Why seventh:** Dynamic text binding enables data-driven pages. Important but less critical than structural and styling foundations.

**Implementation items — Dynamic Text:**
- [ ] `update-text` — accept optional `dynamic: true` field in `server.ts` schema
- [ ] `edit-tools.ts` `updateText()` — when `dynamic: true`, create `ExprText({ expr: CustomCode({ code: text, fallback }), html: false })` instead of `RawText`
- [ ] Accept optional `fallback` string for null/undefined expression results
- [ ] Support converting static ↔ dynamic text (overwrite existing text node type)

**Implementation items — Reading Dynamic Content:**
- [ ] `tree-reader.ts` — show expression source code for `ExprText` nodes (not just `"[dynamic text]"`)
- [ ] `get-node-details` — show full expression including fallback value
- [ ] Display `ObjectPath` expressions in dot notation, `VarRef` as variable name

**Implementation items — Documentation:**
- [ ] Verify and document that component `props` in `add-child` already support CustomCode for dynamic values
- [ ] Document that `update-attrs` dynamic values use `$` prefix or `{{ }}` wrapper (from Priority 3)

**Implementation items — Tests:**
- [ ] Unit tests: dynamic text creation, fallback, static↔dynamic conversion, expression display
- [ ] Integration test: set dynamic text → read tree → verify expression in output

**Files to modify:** `edit-tools.ts`, `server.ts`, `tree-reader.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`, `tree-reader.test.ts`, `real-integration.test.ts`

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

Element Tags & Attrs (P3) ✅ ──► Data Bindings (P7)

Node Cloning (P8) ─── standalone
```

## Completed (P1–P6)

| Priority | Feature | Tests |
|----------|---------|-------|
| P1 | Error Recovery & Resilience | 463 |
| P2 | Slot Override Traversal | 481 |
| P3 | Element Tags & HTML Attributes | 508 |
| P4 | Border Support & CSS Validation | 541 |
| P5 | Design Token References in Styles | 594 |
| P6 | Slot Content Targeting | 608 |
