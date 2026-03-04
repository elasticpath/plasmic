# Implementation Plan

_Last updated: 2026-03-04_

## Priority 1 — Remaining Work

### P1.2 — Fix `project.list` HTTP 500 (JSON encoding bug)
- **Status:** ALREADY FIXED — `api-client.ts:202` already sends `?query=all` and has passing tests
- **Note:** The bug described (JSON.parse failing on bare `all`) may be a server-side issue only triggered with certain Plasmic server versions. The MCP client side is correct.

### P1.3 — `packages/plasmic-mcp/FEATURE_REFERENCE.md` (spec: MCP-FEATURE-REFERENCE.md)
- **Status:** NOT CREATED — file does not exist at the specified path
- **What:** Self-contained developer reference doc covering all 8 domain tools, 104 actions, architecture overview (STRAP pattern), and known feature gaps
- **Source of truth:** `.ralph/specs/MCP-FEATURE-REFERENCE.md` defines the exact structure and content
- **Note:** P1.1 is now implemented, so the doc should reflect 104 actions including `update-props`

## Completed Items

### P1.1 — `node.update-props` action (spec: NODE-UPDATE-PROPS.md) ✓
- **Completed:** 2026-03-04
- **What:** New `update-props` action on the `node` tool for setting/updating prop values on TplComponent instances
- **Files modified:**
  - `packages/plasmic-mcp/src/wab-externals.d.ts` — added `getTplComponentArg`, `setTplComponentArg` declarations
  - `packages/plasmic-mcp/src/__mocks__/wab-tpl-mgr.ts` — added mock implementations
  - `packages/plasmic-mcp/src/edit-tools.ts` — new `updateProps()` export + `UpdatePropsResult` interface
  - `packages/plasmic-mcp/src/server.ts` — added `update-props` to action enum, `props` Zod param, switch case
  - `packages/plasmic-mcp/src/__tests__/node.test.ts` — 13 test cases covering all acceptance criteria
- **Capabilities:** scalar props, dynamic expressions ($expr / {{expr}}), boolean/number literals, slot content (PlasmicElement), prop deletion (null), variant targeting, fail-fast validation, merge semantics
- **Test count:** 1578 unit tests pass (13 new)

---

## Notes

- **Branch context:** `fix/dynamic-value-feature-gap`
- **Action count:** 104 actions across 8 tools (was 103, +1 from `update-props`)
- **Scope:** This plan is scoped to `packages/plasmic-mcp/` only. EP commerce gaps are tracked separately.
