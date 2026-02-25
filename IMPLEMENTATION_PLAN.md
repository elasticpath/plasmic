# Implementation Plan

*Prioritized backlog for plasmic-mcp features. Ordered by dependency graph and impact on the ultimate goal: Claude Code skills that create pages in Plasmic Studio from the terminal.*

---

## Priority 1: Error Recovery & Resilience ✅ COMPLETE
**Spec:** `specs/plasmic-error-recovery.md` (10 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 463 tests passing.
**Files modified:** `edit-tools.ts`, `api-client.ts`, `batch-manager.ts`, `server.ts`

---

## Priority 2: Slot Override Traversal ✅ COMPLETE
**Spec:** `specs/plasmic-slot-override-traversal.md` (10 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 481 tests passing.
**Files modified:** `node-resolver.ts`, `tree-reader.ts`

---

## Priority 3: Element Tags & HTML Attributes ✅ COMPLETE
**Spec:** `specs/plasmic-element-tags-and-attrs.md` (18 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 508 tests passing.
**Files modified:** `edit-tools.ts`, `server.ts`

---

## Priority 4: Border Support & CSS Validation ✅ COMPLETE
**Spec:** `specs/plasmic-border-and-css-validation.md` (8 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 541 tests passing.
**Files modified:** `edit-tools.ts`, `server.ts`, `wab.d.ts`

---

## Priority 5: Design Token References in Styles ✅ COMPLETE
**Spec:** `specs/plasmic-token-refs-in-styles.md` (8 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 594 tests passing.

**What was implemented:**
- [x] `token-reader.ts` — New exports: `mkTokenRef()`, `isTokenRef()`, `parseTokenRefUuid()`, `getAllStyleTokens()`, `findToken()`, `getAcceptableTokenTypes()` for token reference resolution and type validation
- [x] `edit-tools.ts` `resolveTokenReferences()` — converts `token:TokenName` or `token:uuid` to `var(--token-<uuid>)` WAB format; called in `updateStyles()` before `sanitizeStyles()`; validates token existence (case-insensitive name or UUID), type compatibility (Color for color props, Spacing for size props, etc.), and searches dependency tokens
- [x] `tree-reader.ts` `resolveStyleTokenRefs()` — detects `var(--token-<uuid>)` in style values, resolves to CSS values for display, adds `tokenRefs` map (CSS property → token name); `readNodeDetails()` accepts optional `styleTokens` parameter
- [x] `types.ts` — Added `tokenRefs?: Record<string, string>` to `TreeNode`, `styleTokens?: any[]` to `TreeReadOptions`
- [x] `server.ts` — All tree-reading handlers (get-component-tree, get-node-details, get-subtree, export-component-tree) pass `session.site.styleTokens` in options; update-styles tool description mentions `token:TokenName` syntax
- [x] 53 new tests: 22 token-reader (mkTokenRef, isTokenRef, parseTokenRefUuid, getAllStyleTokens, findToken, getAcceptableTokenTypes), 18 edit-tools (resolveTokenReferences by name/UUID/case-insensitive, non-token passthrough, mixed values, empty token name, not-found error, type mismatch, dependency tokens, updateStyles integration), 13 tree-reader (resolve var() to CSS, multiple refs, unknown UUID, token chains, no styleTokens, summary mode, readNodeDetails, readSubtree)

**Key design decisions:**
- Token references stored as `var(--token-<uuid>)` in RuleSet.values (matching WAB/Studio format). This is how Plasmic natively stores token references.
- Tree reader resolves var() to CSS values for human-readable display and adds `tokenRefs` metadata showing which properties use which tokens.
- Token type validation prevents mismatches (e.g., Color token for padding) but allows any token type for unknown properties.
- Token lookup searches local `site.styleTokens` first, then dependency project tokens.

**Files modified:** `edit-tools.ts`, `token-reader.ts`, `tree-reader.ts`, `types.ts`, `server.ts`
**Test files:** `edit-tools.test.ts`, `token-reader.test.ts`, `tree-reader.test.ts`, `server.test.ts`

---

## Priority 6: Slot Content Targeting
**Spec:** `specs/plasmic-slot-targeting.md` (9 criteria)
**Depends on:** Priority 2 (Slot Override Traversal)
**Why sixth:** Enables adding content to specific named slots on component instances. Without this, only the default `children` slot can receive content, limiting component composition.

**Implementation items:**
- [ ] `add-child` — accept new optional `slot` field in `server.ts` schema
- [ ] `edit-tools.ts` `addChild()` — when `slot` specified and parent is TplComponent, add child to named slot's `RenderExpr.tpl[]`
- [ ] If slot has no existing RenderExpr, create new `Arg` + `RenderExpr`
- [ ] If slot already has content, append or insert at `position`
- [ ] Default behavior without `slot`: TplTag containers work as before; TplComponent defaults to `children` slot
- [ ] `remove-child` — support removing nodes from inside slot override content
- [ ] Error if slot name doesn't exist: list available slot names on component
- [ ] Undo and batch mode support
- [ ] Unit tests: add to named slot, create new slot arg, remove from slot, error on invalid slot name
- [ ] Integration test: add-child with slot → verify in tree → undo

**Files to modify:** `edit-tools.ts`, `server.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`, `real-integration.test.ts`

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
Error Recovery (P1) ✅ ─────────────────────────────────┐
                                                         │
Slot Override Traversal (P2) ✅ ──► Slot Targeting (P6) │ All mutation
                                                         │ tools benefit
Element Tags & Attrs (P3) ✅ ──► Data Bindings (P7)     │
                                                         │
Border & CSS Validation (P4) ✅ ───────────────────────┘

Token Refs in Styles (P5) ✅ ─── standalone

Node Cloning (P8) ─── standalone
```

## Status Key

- [ ] Not started
- [~] In progress
- [x] Complete
