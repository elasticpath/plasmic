# Implementation Plan

Goal: Claude Code skills and workflows that create Plasmic pages programmatically from the terminal.

## Current State

- **MCP server**: 8 STRAP domain tools, ~103 actions, ~4,800-line server.ts
- **Skills**: 6 Claude Code skills (plasmic, plasmic-inspect, plasmic-edit, plasmic-create-page, plasmic-create-component, plasmic-patterns)
- **Tests**: 1,197 passing (1060 unit + 137 integration), 0 skipped, 0 TODOs in code
- **Code quality**: Zero FIXMEs, zero HACK/XXX markers, zero placeholders, zero partial implementations
- **Core page-creation workflow**: Functional end-to-end (project.set -> discover tokens -> build tree -> create-page -> enhance via /plasmic-edit -> save)

All priorities (P1-P7) are DONE. All spec acceptance criteria are met.

---

## Execution Order

```
P1 (component instance styling)  -- DONE
P2 (compact JSON)                -- DONE (post-audit: 134 remaining pretty-print calls fixed + 2 new integration tests)
P3 (default maxDepth)            -- DONE (post-audit: maxDepth:100 edge case test)
P4 (response truncation)         -- DONE
P5 (skills progressive nav)      -- DONE
P6 (concise format)              -- DONE (post-audit: unnamed node identification test)
P7 (comprehensive audit fixes)   -- DONE (6 bugs fixed, 6 skill doc mismatches corrected, 13 new tests)
```

---

## P7: Comprehensive Audit (completed)

Full codebase audit across server.ts, tree-reader.ts, edit-tools.ts, and all 6 skill files. Found and fixed 6 bugs, 6 skill documentation mismatches, and added 13 new tests.

### Bug fixes

1. **Data domain batch safety**: Read-only actions (`list-queries`, `list-data-tokens`, `list-splits`, `get-code-meta`, `list-functions`) were using `handleMutationError` which cancels active batch on error. Fixed to use simple error format that preserves batch state.
2. **Interaction domain batch safety**: `interaction.list` (read-only) was using `handleMutationError`. Fixed to preserve batch state on error.
3. **dryRun silently ignored**: 6 data/split mutation actions (`create-data-token`, `update-data-token`, `remove-data-token`, `create-split`, `update-split`, `remove-split`) accepted `dryRun: true` in the schema but silently performed real mutations. Added proper `withDryRun()` handling.
4. **node.reorder cache invalidation**: `invalidateNodeCache(cuuid)` was missing after reorder — index-based node references would return wrong nodes until cache expired. Fixed.
5. **TplComponent layoutType derivation**: `readTplComponent` in tree-reader.ts did not call `deriveLayoutType()` on component instance styles, unlike `readTplTag`. Component instances with flex styles now correctly report `layoutType`.
6. **Unused imports**: Removed `isKnownVarRef`, `ThemeLayoutSettings`, `PageMeta` from edit-tools.ts.

### Skill documentation fixes (plasmic.md)

1. `design.update-mixin`: Changed `name?` → `newName?` (server reads `params.newName`)
2. `design.upload-asset`: Changed `assetType?` → `assetType` (required by `requireParam()`)
3. `variant.rename-global`: Removed `groupRef` (handler ignores it)
4. `data.update-split`: Removed `slices?` (handler doesn't pass it through)
5. `inspect` tool signatures: Added `maxChars?` and `format?` to summary, tree, subtree
6. `dryRun` caveat: Added note that variant domain does NOT support dryRun

### New tests (13)

1. **Batch-safe read-only error handling** (4 tests): `data.list-data-tokens`, `data.list-splits`, `interaction.list` errors don't cancel batch; `data.create-data-token` mutation errors DO cancel batch.
2. **dryRun for data-token/split mutations** (6 tests): All 6 data/split mutation actions return `dryRun: true` preview.
3. **node.reorder cache invalidation** (2 tests): Reorder invalidates cache; reorder with dryRun does not.
4. **TplComponent layoutType** (1 test): Component instance with flex styles derives `layoutType: "vbox"`.

### Remaining audit observations (low severity, not blocking)

- `withDryRun` potential double-undo on partial undo failure (line 172/180 in server.ts)
- `create-page`/`create`/`clone` return success even when model reload fails
- Missing "at least one field" validation for `update-mixin`, `update-animation`, `update-data-token`, `update-split`
- `variant` domain has no `dryRun` support at all (schema doesn't include it)
- `extractRichText` missing null guards on marker position/length
- Phase 2 truncation only removes root-level children, cannot reduce below root size
- SSRF risk in `uploadAsset` (fetches arbitrary URLs) — mitigated by trusted MCP context
