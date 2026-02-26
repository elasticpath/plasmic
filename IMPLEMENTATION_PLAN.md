# Implementation Plan

Goal: Claude Code skills and workflows that create Plasmic pages programmatically from the terminal.

## Current State

- **MCP server**: 8 STRAP domain tools, ~103 actions, ~4,900-line server.ts
- **Skills**: 6 Claude Code skills (plasmic, plasmic-inspect, plasmic-edit, plasmic-create-page, plasmic-create-component, plasmic-patterns)
- **Tests**: 1,171 passing (1038 unit + 129 integration + 4 new server handler tests), 0 skipped, 0 TODOs in code
- **Code quality**: Zero FIXMEs, zero HACK/XXX markers, zero placeholders, zero partial implementations
- **Core page-creation workflow**: Functional end-to-end (project.set -> discover tokens -> build tree -> create-page -> enhance via /plasmic-edit -> save)

All priorities (P1-P6) are DONE. No remaining TODO items.

---

## ~~Priority 6: Concise Response Format (Incremental Optimization)~~ DONE

**Spec**: `specs/response-concise-format.md`

### What was done

- **Added `toConciseFormat()` to `tree-reader.ts`** — post-processing transformation that converts TreeNode trees into a compact orientation format. Root node retains UUID (for subsequent tool calls); all other nodes stripped of UUIDs. Key mappings: `type`→dropped, `nodeType`→dropped, `childCount`→`cc`, `componentName`→`comp`, `componentUuid`→dropped, `slotName`→`slot`, `visibility`→`hidden: true`, `dataCond`→`conditional: true`, `dataRep`→`repeats: true`. Content fields (styles, text, attrs, marks, layoutType) are preserved.
- **Added `format` parameter to inspect Zod schema** — `z.enum(["concise", "full"]).optional()` with descriptive help text.
- **Applied concise transformation in 3 inspect handlers**: `inspect.tree`, `inspect.summary`, `inspect.subtree`. Applied after truncation (P4), before JSON serialization. The transformation is a final pass — it doesn't affect truncation metrics (nodesShown, totalNodes).
- **Updated skills** to reference `format: "concise"`:
  - `plasmic-inspect.md` step 1 (Orient) now includes `format: "concise"` in the example call
  - `plasmic.md` Context Budget section now shows `format: "concise"` for summary queries (~600B)

### Key design decision

Concise format is a post-processing transformation, not a tree-reading option. The tree-reader produces full TreeNode objects with all fields, and `toConciseFormat()` transforms the output before serialization. This keeps the transformation independent of the tree-building pipeline (maxDepth, summaryOnly, excludeStyles, char-budget truncation all work unchanged).

### Test counts

- Unit: 1,038 tests (18 suites) — up from 1,025 (+13 toConciseFormat tests)
- Integration: 129 tests — up from 126 (+3 concise format tests)
- Server handler: +4 tests (tree concise, tree full/omitted, summary concise, subtree concise)
- Total: 1,171 tests

### Checklist

- [x] Add `format: z.enum(["concise", "full"]).optional()` to inspect Zod schema
- [x] Implement `toConciseFormat()` in tree-reader.ts
- [x] Root node always includes UUID (needed for subsequent calls)
- [x] Default to `format: "full"` (backward compatible)
- [x] Measure: 50-node concise summary under 3 KB (verified in unit test)
- [x] Unit tests (13): strips type/nodeType, root UUID preserved, child UUIDs stripped, cc abbreviation, comp/slot abbreviation, hidden/conditional/repeats booleans, preserves styles/text/attrs, recursive transformation, full format unchanged, 50-node size check, minimal node
- [x] Server handler tests (4): tree concise applied, tree full/omitted skips, summary concise, subtree concise
- [x] Integration tests (3): concise summary → drill in by UUID, concise tree structure verification, full format backward compatibility
- [x] Skills updated: plasmic-inspect.md Orient step, plasmic.md Context Budget

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
P5 (skills progressive nav)      -- DONE
P6 (concise format)              -- DONE
```

All priorities complete.
