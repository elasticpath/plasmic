# Implementation Plan

_Last updated: 2026-03-04_

## Priority 1 — Remaining Work

All P1 items completed.

## Completed Items

### P1.4 — Fix `project.list` HTTP 500 (query param encoding) ✓
- **Completed:** 2026-03-04
- **What:** The MCP client sent `?query=all` (bare string) but the server's `parseQueryParams` (util.ts:189) runs `JSON.parse()` on every query param value, expecting JSON-encoded strings. The official Plasmic browser client (`client/api.ts:67`) runs `JSON.stringify(v)` before appending values. `JSON.parse("all")` throws SyntaxError → HTTP 500.
- **Fix:** Changed `api-client.ts:202` from hardcoded `?query=all` to `` ?query=${encodeURIComponent(JSON.stringify("all"))} `` which produces `?query=%22all%22` — matching the official client behavior.
- **Files modified:**
  - `packages/plasmic-mcp/src/api-client.ts` — JSON-encode the query param value
  - `packages/plasmic-mcp/src/__tests__/api-client.test.ts` — updated assertion to match new encoding
- **Test count:** 1578 unit tests pass (no regressions)
- **Note:** The P1.2 entry below incorrectly claimed this was "ALREADY FIXED". Unit tests passed because they mock fetch and never hit the real server's `parseQueryParams`. This was only a real bug when hitting the actual Plasmic server.

### P1.3 — `packages/plasmic-mcp/FEATURE_REFERENCE.md` (spec: MCP-FEATURE-REFERENCE.md) ✓
- **Completed:** 2026-03-04
- **What:** Self-contained developer reference doc covering all 8 domain tools, 104 actions, architecture overview (STRAP pattern), and known feature gaps
- **Files created/modified:**
  - `packages/plasmic-mcp/FEATURE_REFERENCE.md` — new file, full reference document
  - `packages/plasmic-mcp/README.md` — updated action counts (103→104, node 15→16 actions, added `update-props`)
  - `packages/plasmic-mcp/src/index.ts` — updated action count in header comment (99→104)
  - `.ralph/AGENTS.md` — updated action count (103→104)
- **Test count:** 1727 unit tests pass (no regressions)

### P1.2 — Fix `project.list` HTTP 500 (JSON encoding bug) — SUPERSEDED by P1.4
- **Status:** Was incorrectly marked "ALREADY FIXED". See P1.4 for the actual fix.

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

---

## Known Limitations (non-blocking)

| Limitation | Location | Notes |
|-----------|----------|-------|
| Mixin-inherited styles not resolved in inspect output | `tree-reader.ts:14` | MVP limitation — inspect shows only direct VariantSetting styles, not resolved mixin styles |
| Rich text marks cannot combine with dynamic text | `edit-tools.ts:1743` | Use `update-text` with `dynamic:true` instead of `update-rich-text` for dynamic content |
| No interactive/OAuth auth | `auth.ts:6` | Pre-configured credentials only (env vars or `.plasmic.auth` file) |
| `component.create-page/create/clone` don't support dryRun | `server.ts` | Server-side API operations that cannot be previewed |

## Notes

- **Branch context:** `fix/dynamic-value-feature-gap`
- **Action count:** 104 actions across 8 tools
- **Scope:** This plan is scoped to `packages/plasmic-mcp/` only. EP commerce gaps are tracked separately.
