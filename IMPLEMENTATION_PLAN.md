# Implementation Plan

*Prioritized backlog for plasmic-mcp features. Ordered by dependency graph and impact on the ultimate goal: Claude Code skills that create pages in Plasmic Studio from the terminal.*

---

## Priority 8: Node Cloning ✅ COMPLETE
**Spec:** `specs/plasmic-node-cloning.md` (14 criteria)
**Status:** Node cloning implemented and tested. 640 tests passing.

**What was implemented:**
- [x] New `clone-child` tool in `server.ts` — accepts `{ componentUuid, nodeRef, newName?, parentRef?, position?, dryRun? }`
- [x] `edit-tools.ts` — `cloneChild()`: deep clones target node and all descendants
- [x] `deepCloneTpl()` recursive clone with helper functions: `cloneExpr()`, `cloneText()`, `cloneAttrs()`, `cloneRuleSet()`, `cloneArgs()`, `cloneVSettings()`
- [x] Clone inserted as sibling immediately after original by default
- [x] Optional `parentRef` + `position` to insert clone elsewhere
- [x] All cloned nodes get new UUIDs via `crypto.randomUUID()`
- [x] All variant settings (base + non-base) copied — Variant references shared, RuleSet/text/attrs/args independently cloned
- [x] Text content preserved: RawText (static) and ExprText (dynamic with CustomCode/ObjectPath/VarRef)
- [x] Styles preserved via deep-cloned RuleSet
- [x] Attrs preserved via deep-cloned expression map
- [x] Slot override content in TplComponent instances preserved via deep-cloned Arg+RenderExpr
- [x] Cannot clone root node of component (descriptive error)
- [x] Dry-run mode supported (via `withDryRun()` wrapper in server.ts)
- [x] Batch mode supported (via `saveOrAccumulate()`)
- [x] Returns new root node's UUID
- [x] Undo support (via `pushUndoOperation()` in `saveOrAccumulate()`)
- [x] Node cache invalidated after structural clone operation
- [x] Auto-generated clone name: `"Original Name (copy)"` or custom via `newName`
- [x] 16 unit tests: simple clone, custom name, unnamed clone, deep tree, variant settings, attrs with expressions, ExprText, TplComponent slot overrides, parentRef+position, root node error, not-found errors, UUID uniqueness, sibling ordering, save verification, mutation independence
- [x] 3 server integration tests: delegation + result, parameter passthrough, error handling

**Key design decisions:**
- Deep clone implemented in MCP layer (not WAB's `clone()` from `tpls.ts`) so it works with both mocked unit tests and real integration tests
- Variant references (Variant objects) are shared between original and clone — they belong to the component, not the node
- `crypto.randomUUID()` used for UUID generation — compatible with Node.js built-in, produces standard UUIDs
- Clone helpers are private functions (not exported) — only `cloneChild()` is the public API

**Files modified:** `edit-tools.ts`, `server.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`

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

Node Cloning (P8) ✅ ─── standalone
```

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
