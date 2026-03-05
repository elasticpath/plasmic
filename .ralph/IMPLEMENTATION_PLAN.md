# Implementation Plan

_Last updated: 2026-03-05 (audit pass 3)_

## Priority 1 — Hostless Package Management ✅ COMPLETE (2026-03-04)

**Status:** All complete. 4 new actions, 14/14 acceptance criteria, all tests pass. Spec: `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md`

---

## Priority 2 — Plasmic Design Agent Skill ✅ COMPLETE (2026-03-05)

**Status:** All complete. 4-phase agentic loop skill (243 lines), 6/6 acceptance criteria. Spec: `.ralph/specs/PLASMIC-DESIGN-AGENT-SKILL.md`

---

## Priority 3 — EP Commerce Address Validation Bug ✅ COMPLETE (2026-03-05)

**Status:** All bugs fixed, dead code removed, comprehensive tests added. All 889 EP commerce tests pass (36 test suites).

### What was fixed
- **`validateAddressData()`** — field name mismatches: `line1` → `line_1`, `state` → `county`, `postalCode` → `postcode`
- **`sanitizeAddressData()`** — same field name mismatches as above, plus removed nonexistent `company` field reference
- **`validateCustomerData()`** — field name mismatches: `firstName`/`lastName`/`phone` → `name`/`email` to match `CustomerData` interface
- **`sanitizeCustomerData()`** — same field name mismatches as `validateCustomerData()`
- **Missing exports** — added `validateBillingAddress()` and `validateShippingAddress()` exports to `validation.ts`
- **`create-order.ts`** — fixed to use correct EP field names from sanitized data
- **Dead code removed** — `getAddressSuggestions()`, `validateAddressBusinessRules()`, `validatePostalCodeFormat()` (all unused)
- **Tests** — added comprehensive `validation.test.ts` (30+ tests); updated `create-order.test.ts` fixtures to use correct EP field names

### Note
Additional bugs discovered beyond original audit: `CustomerData` interface mismatch in both validate and sanitize functions, and `create-order.ts` field references were also broken.

### Files modified
- `src/api/utils/validation.ts`
- `src/api/endpoints/checkout/create-order.ts`
- `src/api/endpoints/checkout/__tests__/create-order.test.ts`
- `src/api/endpoints/checkout/validate-address.ts`
- `src/api/utils/__tests__/validation.test.ts` (new)

---

## Priority 4 — EP Commerce Test Coverage (Low Priority)

**Status:** Not started
**Location:** `plasmicpkgs/commerce-providers/elastic-path/src/`

~105 of 140 source files have no corresponding test files (75% untested). Breakdown:
- 6 API endpoint handlers untested
- 3 API schema files untested
- 20+ registration files untested (declarative, low risk)
- Checkout components and hooks untested
- 37 test files currently exist covering core logic

Low priority: registration files are declarative, visual components are best validated in Studio. API endpoint handlers are higher priority for testing.

---

## Priority 5 — Address Validation Placeholder (Low Priority)

**Status:** Placeholder implementation
**File:** `plasmicpkgs/commerce-providers/elastic-path/src/api/endpoints/checkout/validate-address.ts`

`normalizeAddress()` is a basic string formatter (comments list integration points: Google Maps, USPS, Loqate, SmartyStreets, HERE). Dead code was removed in P3. Not blocking — requires third-party API key decision outside EP/Plasmic scope.

---

## Priority 6 — Unused Dependencies in plasmicpkgs-dev (Low Priority)

**Status:** Not started
**Location:** `plasmicpkgs-dev/package.json`

Three packages remain as dependencies but their imports and registration calls were removed from `plasmic-register.ts`:
- `@plasmicpkgs/commerce-shopify` (0.0.240)
- `@plasmicpkgs/plasmic-strapi` (0.1.189)
- `@plasmicpkgs/strapi` (0.0.9)

Fix: Remove from `package.json` and run install to clean lockfile.

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
- **MCP server health:** 0 TODOs, 0 skipped tests, 0 stubs in `packages/plasmic-mcp/src/` — 19 source files, 20,085 LOC, 33 test files
- **EP commerce health:** 0 TODOs, 0 FIXMEs, 40 registered components (2 deprecated), 178 total files (141 source, 37 test), 889 tests passing (36 suites). Address validation bugs fixed (P3).
- **plasmic-mcp-registry:** Fully functional at `packages/plasmic-mcp-registry/` — serializes 5 globalThis registries for HTTP transport
- **Existing skills:** 7 files in `.claude/commands/` (plasmic, plasmic-design, plasmic-edit, plasmic-inspect, plasmic-create-component, plasmic-create-page, plasmic-patterns). `/plasmic-design` implements a 4-phase agentic loop; all others are single-pass.
- **Spec:** `.ralph/specs/PLASMIC-DESIGN-AGENT-SKILL.md`
- **P1 spec:** `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md` (complete, for reference)
- **Scope:** This plan covers `packages/plasmic-mcp/`, `.claude/commands/`, and EP commerce gaps. Platform/WAB changes are tracked upstream.
- **Build mechanism:** esbuild `build.mjs` already resolves `@/wab/shared/*` to real WAB source files. Unit tests use mocks via Vite aliases. Integration tests use real WAB source.
