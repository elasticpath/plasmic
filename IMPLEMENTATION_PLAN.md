# Implementation Plan

Goal: Claude Code skills and workflows that create Plasmic pages programmatically from the terminal.

## Current State

- **MCP server**: 8 STRAP domain tools, ~99 actions, 4,844-line server.ts
- **Skills**: 6 Claude Code skills (plasmic, plasmic-inspect, plasmic-edit, plasmic-create-page, plasmic-create-component, plasmic-patterns)
- **Tests**: 1,151 passing (1025 unit + 126 integration), 0 skipped, 0 TODOs in code
- **Code quality**: Zero FIXMEs, zero HACK/XXX markers, zero placeholders, zero partial implementations
- **Core page-creation workflow**: Functional end-to-end (project.set -> discover tokens -> build tree -> create-page -> enhance via /plasmic-edit -> save)

P1, P2, P3, and P4 are DONE. P5-P6 remain TODO.

---

## ~~Priority 1: Fix Component Instance Styling (Functional Blocker)~~ DONE

**Spec**: `specs/fix-component-instance-styles.md`

### What was done

- **Widened `updateStyles()` gate** in `edit-tools.ts` from TplTag-only to `!isKnownTplTag(tpl) && !isKnownTplComponent(tpl)` — matching setVisibility/setDataCond/setDataRep pattern. Error message now says "Only HTML elements and component instances support styling."
- **Fixed tree-reader**: `readTplComponent()` in `tree-reader.ts` was not reading styles from component instances. Added CSS style reading from `compRs.values` (the base variant's RuleSet) — same pattern as `readTplTag()`. This was a **hidden bug**: styles could be written via `updateStyles` but never read back by `inspect.node` or `inspect.tree`.
- **Unit tests**: Replaced TplComponent rejection test with TplComponent success test. Added TplSlot rejection test.
- **Integration test**: Full end-to-end test — add component instance → style it → read back via inspect.node → verify styles applied → clean up.

### Key learning

The original spec only identified the `updateStyles()` gate as the problem, but the tree-reader also had a gap: `readTplComponent()` never read styles from `vs.rs.values`. Both the write path (edit-tools.ts) AND the read path (tree-reader.ts) needed fixing for complete functionality.

---

## ~~Priority 2: Compact JSON Responses (Quick Win)~~ DONE

**Spec**: `specs/response-compact-json.md`

### What was done

- Replaced `JSON.stringify(result, null, 2)` calls in `server.ts` with `JSON.stringify(result)` (compact output).
- **Kept** pretty-printing for `inspect.export` file write (`fs.writeFileSync` — human-readable file output).
- **P4 follow-up**: Fixed 3 remaining pretty-printed response calls missed in P2 (`inspect.node`, `inspect.subtree`, `inspect.export` response).

---

## ~~Priority 3: Default maxDepth on Inspect Actions (Context Safety)~~ DONE

**Spec**: `specs/response-default-maxdepth.md`

### What was done

- **Added `countTplNodes()` to `tree-reader.ts`** — walks the raw Tpl tree (TplTag.children, TplComponent slot overrides, TplSlot.defaultContents) independently of maxDepth to count total nodes for truncation metadata.
- **Default maxDepth in `server.ts` inspect handlers**:
  - `inspect.tree`: defaults to `maxDepth: 3` when not specified
  - `inspect.summary`: defaults to `maxDepth: 2` when not specified
  - `inspect.subtree` and `inspect.node`: no default (unlimited) — targeted drill-down tools
  - `maxDepth: -1` converts to unlimited in all handlers
- **Truncation metadata** added to `inspect.tree` and `inspect.summary` responses:
  - `truncated: boolean` — always present
  - `totalNodes: number` — always present
  - When truncated: `maxDepthApplied`, `hint` ("Use inspect.subtree or inspect.node to drill into specific sections")
  - When not truncated: no `hint` or `maxDepthApplied`
- **Updated Zod schema description** for `maxDepth` param to mention defaults and -1 convention.
- **Updated existing tests**: Added `maxDepth: -1` to ~93 integration test calls that need unlimited depth. Fixed 1 test with duplicate maxDepth key.
- **New tests added** (16 total):
  - 7 `countTplNodes` unit tests (TplTag, TplComponent, TplSlot, null, undefined, leaf, nested)
  - 5 server handler tests (default maxDepth, -1 unlimited, truncation metadata for tree and summary)
  - 4 integration tests (default truncation, summary truncation, unlimited via -1, maxDepth: 0)

### Checklist

- [x] Default `maxDepth: 2` on `inspect.summary` (root -> children -> grandchildren) in the summary handler
- [x] Default `maxDepth: 3` on `inspect.tree` in the tree handler
- [x] Keep unlimited default on `inspect.subtree` and `inspect.node` (targeted drill-down tools)
- [x] Add `maxDepth: -1` support to mean "unlimited" -- convert -1 to undefined before passing to tree-reader
- [x] Add truncation metadata to response when maxDepth truncates:
  - `truncated: boolean`
  - `maxDepthApplied: number`
  - `totalNodes: number` (requires a count traversal)
  - `hint: string` (e.g., "Use inspect.subtree or inspect.node to drill into specific sections")
- [x] Update tree-reader to count total nodes independently of maxDepth for the metadata
- [x] Update existing tests that expect full-depth results to pass explicit `maxDepth: -1`
- [x] Add new tests:
  - [x] summary without maxDepth returns depth-2 tree
  - [x] tree without maxDepth returns depth-3 tree
  - [x] `maxDepth: -1` returns full unlimited tree
  - [x] `maxDepth: 0` returns only root with childCount
  - [x] shallow component (depth < maxDepth) returns `truncated: false`
  - [x] truncation hint is present when `truncated: true`

### Test counts

- Unit: 1,011 tests (18 suites) — up from 999
- Integration: 123 tests — up from 119
- Total: 1,134 tests

---

## ~~Priority 4: Response Truncation Safety Net (Hard Limit)~~ DONE

**Spec**: `specs/response-truncation.md`

### What was done

- **Added `truncateTreeToCharBudget()` to `tree-reader.ts`** — takes a TreeNode and character budget, returns a pruned tree that fits within the budget. Two-phase algorithm: Phase 1 progressively reduces depth (breadth-first priority — shallow nodes preserved over deeper ones), Phase 2 truncates trailing siblings at root level. Always produces valid JSON — prunes whole nodes, never cuts mid-object.
- **Added internal helpers** `getTreeHeight()` and `pruneTreeAtDepth()` for the truncation algorithm.
- **Added `maxChars` parameter to inspect Zod schema** — default 15,000 characters (~4,000 tokens), `-1` for unlimited.
- **Applied char-budget truncation in 3 inspect handlers**: `inspect.tree`, `inspect.summary`, `inspect.subtree`. Each builds the tree with maxDepth first, then applies character-budget truncation as a second layer.
- **Truncation metadata** when char-budget truncates:
  - `truncated: true`, `nodesShown`, `totalNodes`
  - `hint` message references the char budget and guides to `inspect.subtree`
  - When only maxDepth truncates (not chars), existing P3 metadata preserved
- **Fixed 3 P2 regressions**: `inspect.node`, `inspect.subtree`, and `inspect.export` response were still using `JSON.stringify(result, null, 2)` (pretty-printed). Now compact.
- **New tests added** (17 total):
  - 9 `truncateTreeToCharBudget` unit tests (under budget, null tree, depth pruning, sibling truncation, tight budget, valid JSON, immutability, deep tree, result within budget)
  - 5 server handler tests (default maxChars, custom maxChars, -1 unlimited, char truncation hint)
  - 3 integration tests (small maxChars with hint, unlimited maxChars, summary with small maxChars)

### Key design decision

The spec suggested depth-first serialization with accumulator. Instead, we use a post-serialization pruning approach: build the full tree (with maxDepth), serialize to JSON, check length, and progressively prune if over budget. This is simpler, always produces valid JSON, and naturally preserves breadth-first priority by removing the deepest levels first.

### Test counts

- Unit: 1,025 tests (18 suites) — up from 1,011
- Integration: 126 tests — up from 123
- Total: 1,151 tests

---

## Priority 5: Skills Progressive Navigation (Best Practices)

**Spec**: `specs/skills-progressive-navigation.md`

The progressive navigation pattern is IMPLIED but not FORMALIZED in any skill. `plasmic-inspect.md` is closest (lines 50-54: "summary first, then node, then tree only when explicitly needed"). But multiple skills show `inspect.tree` without maxDepth, and none reference `format: "concise"` or truncation hints.

### Checklist

- [ ] Update `plasmic.md` (router):
  - [ ] Add "Context Budget" section explaining MCP response costs
  - [ ] Add guidance: "Use the most targeted inspect action available"
  - [ ] Priority ordering: inspect.node > inspect.summary > inspect.subtree > inspect.tree (last resort)
- [ ] Update `plasmic-inspect.md`:
  - [ ] Add explicit 4-step navigation pattern: Orient -> Locate -> Detail -> Full
  - [ ] Add `format: "concise"` references (depends on P6 being done, or document as upcoming)
  - [ ] Add guidance on following truncation hints
  - [ ] Add AVOID section: no `inspect.tree` without maxDepth
- [ ] Update `plasmic-edit.md`:
  - [ ] Add targeted verification: "After editing, use inspect.node on the edited node, NOT inspect.tree"
  - [ ] Remove or qualify any references to inspect.tree for verification
- [ ] Update `plasmic-create-page.md`:
  - [ ] Add post-creation verification: "Verify with inspect.summary (maxDepth: 1-2), not full tree"
- [ ] Update `plasmic-create-component.md`:
  - [ ] Same post-creation verification guidance
  - [ ] Update line 190: recommend summary before tree for clone inspection
- [ ] Ensure no skill instructs `inspect.tree` without maxDepth
- [ ] Add references to `format: "concise"` where appropriate (once P6 is implemented)
- [ ] Add guidance on following truncation hints (once P4 is implemented)

**Files**: `.claude/commands/plasmic.md`, `.claude/commands/plasmic-inspect.md`, `.claude/commands/plasmic-edit.md`, `.claude/commands/plasmic-create-page.md`, `.claude/commands/plasmic-create-component.md`

**Dependencies**: Should be implemented AFTER P2-P4 so referenced features actually exist. Can partially implement (maxDepth guidance) before P6 (format: "concise").

---

## Priority 6: Concise Response Format (Incremental Optimization)

**Spec**: `specs/response-concise-format.md`

Optional `format: "concise"` mode for inspect actions. Strips UUIDs (except root), abbreviates keys (`childCount` -> `cc`), replaces detail with booleans (`dataCond` -> `conditional: true`). ~70% token reduction for orientation-only queries.

### Checklist

- [ ] Add `format: z.enum(["concise", "full"]).optional()` to inspect Zod schema
- [ ] Implement concise serialization in tree-reader:
  - Strip UUIDs from all nodes except root
  - Abbreviate keys: `childCount` -> `cc`, `componentName` -> `comp`, `componentUuid` -> `compId`
  - Replace `visibility` with `hidden: true`
  - Replace `dataCond` expression with `conditional: true`
  - Replace `dataRep` object with `repeats: true`
  - Drop `type` field (inferable from tag/componentName/slotName presence)
  - Drop `nodeType` field
- [ ] Root node always includes UUID (needed for subsequent calls)
- [ ] Default to `format: "full"` (backward compatible)
- [ ] Measure: 50-node concise summary should be under 3 KB
- [ ] Unit tests:
  - [ ] Concise format strips UUIDs from non-root nodes
  - [ ] Concise format abbreviates keys correctly
  - [ ] Concise format replaces detail fields with booleans
  - [ ] Root node retains UUID in concise format
  - [ ] Full format is unchanged (backward compatible)
- [ ] Integration test: concise summary -> identify node by name -> drill in with inspect.node

**Files**: `packages/plasmic-mcp/src/tree-reader.ts`, `packages/plasmic-mcp/src/types.ts`, `packages/plasmic-mcp/src/server.ts` (inspect handlers)

**Dependencies**: None functionally, but should be implemented after P3 and P4 for maximum combined effect. Skills (P5) should reference this after it exists.

---

## Confirmed Not Needed (Investigated and Dismissed)

- **Publishing/deployment**: `project.save` already persists changes to Plasmic API; publishing to CDN is a Studio concern
- **Global component library browsing**: `findComponentByNameOrUuid()` resolves both local and dependency components; users import packages in Studio
- **Cross-project imports**: Outside MCP scope; handled by Studio's package system
- **PlasmicElement pre-validation**: Server API validates on create-page; `plasmicElementToTpl()` validates on node.add -- WAB produces clear validation errors
- **Onboarding skill**: Router skill already handles "no project set" case with project.list flow
- **End-to-end docs**: Skills ARE the workflow docs; progressive navigation spec (P5) addresses remaining gaps
- **Create-page integration test with body**: Unit test covers this; not a spec-level concern
- **Error message improvements for self-correction**: Reviewed all error patterns -- existing error messages are descriptive and actionable (e.g., "Node X is not a TplTag and cannot have styles updated" tells the agent exactly what went wrong). The `handleMutationError()` pattern (7 call sites in server.ts) wraps WAB errors with domain context (`Error in domain.action: message`). No changes needed beyond P1 gate removals which will let WAB produce its own natural errors.
- **Additional PlasmicElement patterns**: `plasmic-patterns.md` already covers hero, feature grid, card, form, nav, footer, pricing, testimonial, CTA, and gallery. Post-creation enhancement recipes cover data-driven grids, counters, conditionals, navigation, forms with state, rich text, and animations. Coverage is comprehensive for the target use case.
- **Batch operation guidance in skills**: `plasmic-edit.md` (line 84) already instructs "For 3+ edits, wrap in begin-batch/end-batch". Sufficient.
- **Additional skill for design system management**: Router skill (plasmic.md) handles token/mixin/animation/theme CRUD directly with clear routing patterns. A dedicated skill would duplicate content without adding value.
- **Streaming responses**: MCP SDK does not support streaming tool results. Character-budget truncation (P4) is the appropriate mitigation.

---

## Execution Order

```
P1 (component instance styling)  -- DONE
P2 (compact JSON)                -- DONE
P3 (default maxDepth)            -- DONE
P4 (response truncation)         -- DONE
P5 (skills progressive nav)      -- after P2-P4, references server features
P6 (concise format)              -- after P3-P4, incremental optimization
```

P5 is next. P5 updates skill documentation to formalize the progressive navigation pattern (orient → locate → detail → full) and reference the server features from P2-P4. P6 can be done before or after P5 (P5 should be updated after P6 to reference `format: "concise"`).
