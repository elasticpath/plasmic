# Implementation Plan

_Last updated: 2026-03-04 — Plan only, no implementations._

## Priority 1 — Spec-Defined Features (Missing)

### P1.1 — `node.update-props` action (spec: NODE-UPDATE-PROPS.md)
- **Status:** NOT IMPLEMENTED — zero matches for `update-props` or `updateProps` in `packages/plasmic-mcp/src/`
- **What:** New action on the `node` tool to set/update prop values on TplComponent instances (component instances placed in the tree). Currently there is NO way via MCP to pass props to a placed component instance — only the schema (`component.add-prop`/`update-prop`) and HTML attributes (`node.update-attrs`) are covered.
- **Files to create/modify:**
  - `packages/plasmic-mcp/src/edit-tools.ts` — new `updateProps()` export
  - `packages/plasmic-mcp/src/server.ts` — add `update-props` case to the node tool switch + Zod schema for `props` parameter
  - `packages/plasmic-mcp/src/wab-externals.d.ts` — add `isKnownTplComponent`, `isSlot` type guards if missing
- **Key reuse:** `createAttrExpr()` for scalar/dynamic values, `plasmicElementToTpl()` for slot content, `setTplComponentArg()` from WAB TplMgr
- **Test:** New test cases in `packages/plasmic-mcp/src/__tests__/node.test.ts`
- **Impact:** HIGH — this is the #1 feature gap blocking data-driven component wiring via MCP

### P1.2 — Fix `project.list` HTTP 500 (JSON encoding bug)
- **Status:** BUG — `api-client.ts:202` sends `?query=all` but the server's `parseQueryParams` (`platform/wab/src/wab/server/routes/util.ts:189`) runs `JSON.parse()` on every query param value, expecting `?query="all"` (JSON-encoded string). `JSON.parse("all")` throws `SyntaxError`.
- **Files to modify:**
  - `packages/plasmic-mcp/src/api-client.ts:202` — change `?query=all` to `?query=%22all%22` (URL-encoded `"all"`)
- **Test:** Update existing test in `packages/plasmic-mcp/src/__tests__/api-client.test.ts` to verify the corrected URL
- **Impact:** HIGH — `project.list` is completely broken, blocking project discovery

### P1.3 — `packages/plasmic-mcp/FEATURE_REFERENCE.md` (spec: MCP-FEATURE-REFERENCE.md)
- **Status:** NOT CREATED — file does not exist at the specified path
- **What:** Self-contained developer reference doc covering all 8 domain tools, ~104 actions, architecture overview (STRAP pattern), and known feature gaps
- **Source of truth:** `.ralph/specs/MCP-FEATURE-REFERENCE.md` defines the exact structure and content
- **Note:** The spec content itself is complete and accurate against the current codebase (103 actions exist; `update-props` is action #104). Create the file once P1.1 is implemented, or create it now documenting `update-props` as "planned"

## Completed Items

_(None yet — plan only, no implementations performed)_

---

## Notes

- **Branch context:** `fix/dynamic-value-feature-gap` — targeting P1.1 (`update-props`) and P1.2 (feature reference doc)
- **Action count:** Current codebase has 103 actions across 8 tools. Adding `update-props` brings it to 104 (matching the spec's count)
- **Scope:** This plan is scoped to `packages/plasmic-mcp/` only. EP commerce gaps are tracked separately.
