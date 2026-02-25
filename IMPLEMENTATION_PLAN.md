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

## Priority 2: Slot Override Traversal ✅ COMPLETE
**Spec:** `specs/plasmic-slot-override-traversal.md` (10 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 481 tests passing.

**What was implemented:**
- [x] `node-resolver.ts` `getChildren()` — traverses TplComponent slot overrides via `vsettings[0].args` → `isKnownRenderExpr(arg.expr)` → `arg.expr.tpl[]`
- [x] `node-resolver.ts` `flattenWithPaths()` — inserts slot name as path segment for override nodes (e.g., `Card.children.Title`)
- [x] `tree-reader.ts` `readTplComponent()` — separates slot args (RenderExpr → children) from non-slot args (CustomCode etc. → attrs); slot overrides grouped by slot name as `type: "slot"` wrapper nodes
- [x] `tree-reader.ts` `getTplChildren()` — returns flat list of slot override tpl nodes for TplComponent
- [x] `tree-reader.ts` `readNodeDetails()` — TplComponent shows slot-grouped children as summaries
- [x] Path format: `ComponentName.slotName.NodeName` (e.g., `Root.Card.children.Title`)
- [x] All mutation tools work on override nodes (resolved by UUID/name/path through existing edit-tools)
- [x] Edge cases: nested TplComponent in overrides (recursive traversal), non-RenderExpr args (skipped), empty slot (skipped), TplComponent with no args (returns [])
- [x] Summary mode: `childCount` on TplComponent = total slot override tpl nodes; slot wrappers get `childCount`
- [x] 18 new tests: 10 node-resolver (UUID/name/path/multiple slots/nested/text content) + 8 tree-reader (grouping/multiple slots/mixed args/nested/summary/empty/nodeDetails)

**Key design decisions:**
- RenderExpr args are treated as slot overrides; all other arg types (CustomCode, VarRef, etc.) remain as attrs. This matches Studio's `getSlotArgs()` pattern.
- Slot wrapper nodes use `type: "slot"` with `slotName`, reusing the existing TreeNode type (no schema changes needed).

**Files modified:** `node-resolver.ts`, `tree-reader.ts`
**Test files:** `node-resolver.test.ts`, `tree-reader.test.ts`

---

## Priority 3: Element Tags & HTML Attributes ✅ COMPLETE
**Spec:** `specs/plasmic-element-tags-and-attrs.md` (18 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 508 tests passing.

**What was implemented:**
- [x] `edit-tools.ts` `plasmicElementToTpl()` — `tag` field on container elements validated against allowlist (`div`, `section`, `article`, `nav`, `header`, `footer`, `aside`, `main`, `ul`, `ol`, `li`, `form`, `fieldset`)
- [x] `tag` field on text elements validated against allowlist (`div`, `p`, `span`, `h1`-`h6`, `label`, `a`, `blockquote`, `pre`, `code`)
- [x] Unsafe tags (`script`, `style`, `iframe`) rejected with clear error listing allowed alternatives
- [x] Tag already reflected in `get-component-tree` output (tree-reader reads `tpl.tag`)
- [x] New `update-attrs` tool in `server.ts` — `{ componentUuid, nodeRef, attrs: { key: value } }` with variant targeting and dry-run
- [x] `edit-tools.ts` `updateAttrs()` — static string values → `CustomCode(JSON.stringify())`, dynamic values (`$` prefix or `{{...}}`) → `CustomCode(expression)`
- [x] Standard HTML attrs supported: `id`, `class`, `href`, `target`, `rel`, `title`, `tabIndex`, `type`, `name`, `placeholder`, `value`, `disabled`, `checked`, plus `src`, `alt`, `width`, `height`, `action`, `method`, `for`, `autocomplete`, `autofocus`, `required`, `readonly`, `min`, `max`, `step`, `pattern`, `maxlength`, `minlength`
- [x] ARIA attrs supported: `role`, `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-hidden`, `aria-expanded`, `aria-selected`, `aria-disabled`, plus 14 more ARIA attrs
- [x] `data-*` attributes (any name) supported
- [x] Event handler attrs (`onclick`, `onload`, etc.) rejected for security
- [x] Attribute removal via `null` value — `delete vs.attrs[key]`
- [x] Attrs processed during element creation (`plasmicElementToTpl`) for both container and text elements
- [x] 27 new unit tests: tag validation (container/text/unsafe/invalid/all-valid), updateAttrs (static/dynamic/remove/ARIA/data/event-handler/boolean/variant), attrs-during-creation

**Key design decisions:**
- Attribute values are stored as `CustomCode` expressions (matching WAB's `codeLit()` pattern, already used for img src and component props).
- `isValidAttrName()` allows custom-element-style hyphenated names (e.g., `my-attr`) to support web components.
- Validation happens before any model mutation, so invalid attrs never corrupt the model.
- No changes needed to `tree-reader.ts` or `types.ts` — attrs were already read via `extractAttrs()` and the `TreeNode.attrs` field was already typed.

**Files modified:** `edit-tools.ts`, `server.ts`
**Test files:** `edit-tools.test.ts`

---

## Priority 4: Border Support & CSS Validation ✅ COMPLETE
**Spec:** `specs/plasmic-border-and-css-validation.md` (8 criteria — all implemented)
**Status:** All acceptance criteria implemented and tested. 541 tests passing.

**What was implemented:**
- [x] `edit-tools.ts` `sanitizeStyles()` — `parseBorderShorthand()` parses `border` shorthand (e.g., `"1px solid #FCA5A5"`) into width/style/color parts, expanded to 12 longhands (`border-{top,right,bottom,left}-{width,style,color}`)
- [x] `border-top`, `border-right`, `border-bottom`, `border-left` shorthands (camelCase and kebab-case) parsed and expanded to 3 longhands each
- [x] `outline` shorthand parsed and expanded to `outline-width`, `outline-style`, `outline-color`
- [x] Special values: `border: none` → 4 style longhands set to "none"; `border: inherit` → all 12 longhands set to "inherit"; CSS global values (initial, unset, revert) all handled
- [x] `parseBorderShorthand()` handles rgb()/rgba() color values via `splitCssTokens()` (respects parenthesized groups)
- [x] Border width keywords (thin, medium, thick) recognized alongside numeric values
- [x] `isValidStyleProp()` — checks css-initials package + ADDITIONAL_VALID_PROPERTIES set; allows CSS custom properties (`--*`) and vendor-prefixed properties
- [x] `validateStyleProperties()` — called in `updateStyles()` after sanitization; throws descriptive error with Levenshtein-based "Did you mean?" suggestions and shorthand expansion hints
- [x] `levenshteinDistance()` — fuzzy matching for closest 3 valid property names within distance ≤ 4
- [x] `SHORTHAND_HINTS` — error messages include hints about handled shorthands (e.g., "border → border-{top,right,bottom,left}-{width,style,color}")
- [x] New `list-style-properties` tool in `server.ts` — returns sorted list of all valid CSS property names, optional `filter` parameter for substring search
- [x] `update-styles` tool description updated to document backgroundColor→background mapping and shorthand expansion
- [x] Type declaration for `css-initials` package added to `wab.d.ts`
- [x] 33 new tests: 15 border shorthand (3-value/2-value/1-value/none/inherit/rgb/keywords/sides/combined), 2 outline, 6 isValidStyleProp, 7 validateStyleProperties, 3 getValidStylePropertyNames

**Key design decisions:**
- Validation runs AFTER sanitization in updateStyles() — shorthands are expanded to longhands first, then each longhand is validated. Invalid properties that pass through sanitizeStyles' default case are caught by validation.
- Handled shorthands (border, padding, margin, etc.) are included in the valid properties set so they appear as "Did you mean?" suggestions, even though they're expanded before reaching validation.
- ADDITIONAL_VALID_PROPERTIES supplements css-initials with modern CSS properties (row-gap, aspect-ratio, grid-*, etc.) and handled shorthands.

**Files modified:** `edit-tools.ts`, `server.ts`, `wab.d.ts`
**Test files:** `edit-tools.test.ts`

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
Error Recovery (P1) ✅ ─────────────────────────────────┐
                                                         │
Slot Override Traversal (P2) ✅ ──► Slot Targeting (P6) │ All mutation
                                                         │ tools benefit
Element Tags & Attrs (P3) ✅ ──► Data Bindings (P7)     │
                                                         │
Border & CSS Validation (P4) ✅ ───────────────────────┘

Token Refs in Styles (P5) ─── standalone

Node Cloning (P8) ─── standalone
```

## Status Key

- [ ] Not started
- [~] In progress
- [x] Complete
