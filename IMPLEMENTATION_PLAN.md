# Implementation Plan

*Prioritized backlog for plasmic-mcp features. Ordered by dependency graph and impact on the ultimate goal: Claude Code skills that create pages in Plasmic Studio from the terminal.*

---

## Priority 1: Error Recovery & Resilience ✅ COMPLETE
**Spec:** `specs/plasmic-error-recovery.md` (10 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 463 tests passing.

**What was implemented:**
- [x] Auto-rollback in `edit-tools.ts` — `saveOrAccumulate()` catches save failures, calls `undoChanges()` to revert in-memory model, re-throws error
- [x] Validation errors (wrong node type, missing component) do NOT accumulate in change tracker — errors throw before `withRecording()` runs
- [x] Batch mode: `cancelBatchWithRollback()` cancels batch and undoes all accumulated changes; `endBatch()` rolls back on save failure
- [x] API client timeout — 30s default via `AbortSignal.timeout()` with `TimeoutError`-specific messaging
- [x] 5xx error messages include HTTP status code and retry suggestion
- [x] `listProjects()` failure includes specific auth/connectivity troubleshooting guidance
- [x] Server.ts tool handlers: `handleMutationError()` centralizes error handling; auto-cancels batch with rollback if active during any mutation failure
- [x] Unit tests: rollback on save failure (updateStyles, updateText), clean undo stack after failure, no revision increment on failure, subsequent mutation succeeds without refresh, validation-only errors don't record changes, rollback failure → refresh-project guidance
- [x] Batch tests: cancelBatchWithRollback undoes accumulated changes, endBatch rolls back on save failure, graceful handling of rollback failures
- [x] API client tests: timeout signal passed to fetch, timeout error guidance, 5xx retry guidance, listProjects auth guidance, custom timeout support

**Files modified:** `edit-tools.ts`, `api-client.ts`, `batch-manager.ts`, `server.ts`
**Test files:** `edit-tools.test.ts`, `api-client.test.ts`, `batch-manager.test.ts`, `server.test.ts`

---

## Priority 2: Slot Override Traversal
**Spec:** `specs/plasmic-slot-override-traversal.md` (8 criteria)
**Why next:** Foundation for slot-related editing. Currently, content inside component instance slots (TplComponent → Arg → RenderExpr → tpl[]) is invisible to tree reading and node resolution. This blocks slot targeting (Priority 6) and limits component composition workflows.

**Implementation items:**
- [ ] `node-resolver.ts` — modify `getChildren()` / `flattenWithPaths()` to traverse TplComponent slot overrides via `getSlotArgs()` → `RenderExpr.tpl[]`
- [ ] `tree-reader.ts` — modify `getTplChildren()` to include slot override nodes in tree output, grouped by slot name
- [ ] Path format for slot override nodes: `ComponentName.slotName.NodeName` (e.g., `Card.children.Title`)
- [ ] All mutation tools work on override nodes: `update-text`, `update-styles`, `add-child`, `remove-child`, `move-child`
- [ ] Handle edge cases: nested TplComponents in overrides, non-RenderExpr args (skip gracefully)
- [ ] Unit tests: traverse overrides, resolve by UUID/name/path, mutate override text/styles
- [ ] Integration test: create component instance with slot content → traverse → edit → verify

**Files to modify:** `node-resolver.ts`, `tree-reader.ts`
**Test files:** `node-resolver.test.ts`, `tree-reader.test.ts`, `real-integration.test.ts`

---

## Priority 3: Element Tags & HTML Attributes
**Spec:** `specs/plasmic-element-tags-and-attrs.md` (18 criteria)
**Why third:** Semantic HTML is critical for page creation. Currently all containers render as `<div>` regardless of `tag` field. The `update-attrs` tool is needed for links (`href`), accessibility (`aria-*`), form attributes, and data attributes — all essential for real pages.

**Implementation items — Tags:**
- [ ] `edit-tools.ts` `plasmicElementToTpl()` — honor `tag` field on container elements (validate against allowed list: `div`, `section`, `article`, `nav`, `header`, `footer`, `aside`, `main`, `ul`, `ol`, `li`, `form`, `fieldset`)
- [ ] Honor `tag` field on text elements (validate: `div`, `p`, `span`, `h1`-`h6`, `label`, `a`, `blockquote`, `pre`, `code`)
- [ ] Reject unsafe tags (`script`, `style`, `iframe`) with clear error
- [ ] Reflect tag in `get-component-tree` output (already partially done in `tree-reader.ts`)

**Implementation items — Attributes:**
- [ ] New `update-attrs` tool in `server.ts` — accepts `{ componentUuid, nodeRef, attrs: { key: value } }`
- [ ] `edit-tools.ts` — implement `updateAttrs()`: static values → literal expressions, dynamic values (`$` prefix or `{{...}}`) → CustomCode
- [ ] Support standard HTML attrs: `id`, `class`, `href`, `target`, `rel`, `title`, `tabIndex`, `type`, `name`, `placeholder`, `value`, `disabled`, `checked`
- [ ] Support ARIA attrs: `role`, `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-hidden`, `aria-expanded`, `aria-selected`, `aria-disabled`
- [ ] Support `data-*` attributes (any name)
- [ ] Reject event handler attrs (`onclick`, `onload`, etc.) for security
- [ ] Attribute removal: pass `null` to delete
- [ ] Variant targeting and dry-run support on `update-attrs`
- [ ] Unit tests: tag validation, attr setting/removal, dynamic attrs, variant-aware attrs
- [ ] Integration test: create element with tag → set attrs → read back → verify

**Files to modify:** `edit-tools.ts`, `server.ts`, `tree-reader.ts`, `types.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`, `real-integration.test.ts`

---

## Priority 4: Border Support & CSS Validation
**Spec:** `specs/plasmic-border-and-css-validation.md` (8 criteria)
**Why fourth:** Border shorthand is the most commonly attempted CSS shorthand that fails silently. Better validation errors help Claude self-correct when using invalid properties.

**Implementation items:**
- [ ] `edit-tools.ts` `sanitizeStyles()` — parse `border` shorthand (e.g., `"1px solid #FCA5A5"`) into 12 longhands (`border-{top,right,bottom,left}-{width,style,color}`)
- [ ] Parse `border-top`, `border-right`, `border-bottom`, `border-left` shorthands (3 longhands each)
- [ ] Parse `outline` shorthand (`outline-width`, `outline-style`, `outline-color`)
- [ ] Handle special values: `border: none` → all widths to `0`, `border: inherit` → all longhands to `inherit`
- [ ] `isValidStyleProp()` function — use `css-initials` package to check if a property has a known initial value
- [ ] Invalid property error message: include property name, fuzzy-matched suggestions (Levenshtein or similar), shorthand expansion hints
- [ ] New `list-style-properties` tool (or parameter) in `server.ts` returning all valid property names
- [ ] Unit tests: border shorthand parsing (all variants), outline parsing, validation error messages
- [ ] Integration test: apply border shorthand → verify 12 longhands stored

**Files to modify:** `edit-tools.ts`, `server.ts`
**Test files:** `edit-tools.test.ts`, `server.test.ts`, `real-integration.test.ts`

---

## Priority 5: Design Token References in Styles
**Spec:** `specs/plasmic-token-refs-in-styles.md` (8 criteria)
**Why fifth:** Token references connect Claude's styling to the project's design system. Without this, every color/spacing value is hardcoded, making designs inconsistent and hard to maintain.

**Implementation items:**
- [ ] `edit-tools.ts` `updateStyles()` — detect `token:TokenName` or `token:uuid` format in style values
- [ ] Look up token in `site.styleTokens` by name (case-insensitive) or UUID
- [ ] Resolve token value and use it for `RSH.merge()` call
- [ ] Preserve token reference as metadata so `get-component-tree` / `get-node-details` shows both `"token:Primary Blue"` and resolved `"#0070f3"`
- [ ] Validate token type against CSS property (Color token for color props, Spacing for size props)
- [ ] Error if token doesn't exist: list available tokens of matching type
- [ ] Search across dependency tokens (imported token sets)
- [ ] Unit tests: token resolution by name/uuid, case-insensitive, type validation, error messages
- [ ] Integration test: apply token ref → read tree → verify both reference and resolved value

**Files to modify:** `edit-tools.ts`, `tree-reader.ts`, `token-reader.ts`
**Test files:** `edit-tools.test.ts`, `tree-reader.test.ts`, `real-integration.test.ts`

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
Error Recovery (P1) ✅ ──────────────────────────────────┐
                                                          │
Slot Override Traversal (P2) ──► Slot Targeting (P6)     │ All mutation
                                                          │ tools benefit
Element Tags & Attrs (P3) ────► Data Bindings (P7)       │
                                                          │
Border & CSS Validation (P4) ────────────────────────────┘

Token Refs in Styles (P5) ─── standalone

Node Cloning (P8) ─── standalone
```

## Status Key

- [ ] Not started
- [~] In progress
- [x] Complete
