# Implementation Plan

_Last updated: 2026-03-05 (audit pass 6)_

## Completed Priorities (collapsed)

- **P1** — Hostless Package Management ✅ (2026-03-04) — 4 new actions, 14/14 criteria
- **P2** — Plasmic Design Agent Skill ✅ (2026-03-05) — 4-phase agentic loop, 6/6 criteria
- **P3** — EP Commerce Address Validation Bug ✅ (2026-03-05) — field name mismatches, dead code removal, tests
- **P4** — EP Commerce Test Coverage ✅ (2026-03-05) — 290 new tests (889→1179), 11 new suites (utils, normalize, checkout hooks, product hooks)
- **P6** — Unused Dependencies in plasmicpkgs-dev ✅ (2026-03-05) — removed 3 packages from package.json AND plasmic-register.ts imports

---

## Priority 5 — Address Validation Placeholder (Low Priority)

**Status:** Placeholder implementation
**File:** `plasmicpkgs/commerce-providers/elastic-path/src/api/endpoints/checkout/validate-address.ts`

`normalizeAddress()` is a basic string formatter (comments list integration points: Google Maps, USPS, Loqate, SmartyStreets, HERE). Dead code was removed in P3. Not blocking — requires third-party API key decision outside EP/Plasmic scope.

---

## Priority 7 — plasmic-admin Source Code (Low Priority)

**Status:** Dist-only (source reverted)
**Location:** `packages/plasmic-admin/`

Package has pre-compiled `dist/` but no `src/`. Source was added in commit `5a4782d25` then reverted in `be7b9ef63`. Provides `PlasmicAdminClient` HTTP client for admin API (project CRUD, workspace CRUD, admin operations). Dist files are functional. Source reconstruction available from git history if admin client requires modification.

---

## Known Limitations (non-blocking)

| Limitation | Location | Notes |
|-----------|----------|-------|
| Mixin-inherited styles not resolved in inspect output | `tree-reader.ts:14` | MVP limitation — inspect shows only direct VariantSetting styles, not resolved mixin styles |
| Rich text marks cannot combine with dynamic text | `edit-tools.ts:1743` | Use `update-text` with `dynamic:true` instead of `update-rich-text` for dynamic content |
| No interactive/OAuth auth | `auth.ts:6` | Pre-configured credentials only (env vars or `.plasmic.auth` file) |
| `component.create-page/create/clone` don't support dryRun | `server.ts` | Server-side API operations that cannot be previewed |

## False Positives — Verified Non-Issues

| Item | Disposition |
|------|-------------|
| "Unimplemented spec actions" (list-design-system, list-patterns, capture-screenshot) | Do not exist in any spec, doc, or code. Not real gaps. |
| Silent error catches in MCP server (10 instances) | All documented with intent comments. Intentional error boundaries. |

## Notes

- **Branch context:** `feat/plasmic-design-agent-skill`
- **Action count:** 108 actions across 8 tools (project: 12, inspect: 8, component: 18, node: 16, variant: 12, design: 22, data: 16, interaction: 4)
- **MCP server health:** 0 TODOs, 0 skipped tests, 0 stubs — 1616 unit tests (30 suites), 170 integration tests (3 suites), typecheck clean
- **EP commerce health:** 0 TODOs, 0 FIXMEs — 1179 tests passing (47 suites, Jest). Use `yarn test` not `npx vitest run`.
- **plasmic-mcp-registry:** 79 tests passing (5 suites, Vitest)
- **Existing skills:** 7 files in `.claude/commands/` (plasmic, plasmic-design, plasmic-edit, plasmic-inspect, plasmic-create-component, plasmic-create-page, plasmic-patterns)
- **Specs:** `.ralph/specs/PLASMIC-DESIGN-AGENT-SKILL.md`, `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md`
- **Scope:** This plan covers `packages/plasmic-mcp/`, `.claude/commands/`, and EP commerce gaps. Platform/WAB changes are tracked upstream.
- **Build mechanism:** esbuild `build.mjs` resolves `@/wab/shared/*` to real WAB source files. Unit tests use mocks via Vite aliases. Integration tests use real WAB source.
