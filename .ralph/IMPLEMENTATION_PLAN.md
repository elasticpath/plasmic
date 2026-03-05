# Implementation Plan

_Last updated: 2026-03-05 (audit pass 2)_

## Priority 1 — Hostless Package Management ✅ COMPLETE

**Branch:** `feat/hostless-package-management`
**Spec:** `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md` — all 14 acceptance criteria checked
**Status:** All complete. 4 new actions (list-packages, add-package, remove-package, upgrade-package) wired into the project tool. Action count: 104 → 108. All 1,779 tests pass (33 files).

### P1.6 — ensureCanUpgradeDeps pre-check ✅
- **Completed:** 2026-03-04
- **What:** Added `ensureCanUpgradeDeps` pre-flight check to `upgradePackage()` that detects transitive version conflicts before calling `upgradeProjectDeps`. Mirrors Studio's `ProjectDependencyManager.ensureCanUpgradeDeps` BFS-walk logic.
- **Why:** Without this guard, a batch upgrade that creates transitive version conflicts would mutate the site model before detecting the problem. The guard aborts before any mutation.
- **Files modified:** `packages/plasmic-mcp/src/package-manager.ts`, `packages/plasmic-mcp/src/__tests__/package-manager.test.ts`
- **Spec updated:** `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md` — all 14 acceptance criteria checked, validation reuse note corrected (client-only class requires local reimplementation)

---

## Priority 2 — Plasmic Design Agent Skill ✅ COMPLETE

**Branch:** `feat/plasmic-design-agent-skill`
**Spec:** `.ralph/specs/PLASMIC-DESIGN-AGENT-SKILL.md` — all 6 acceptance criteria addressed
**Deliverable:** `.claude/commands/plasmic-design.md` — prompt-only skill file (no server-side code)
**Status:** Complete. Skill file created with 4-phase agentic loop (243 lines). Registered as `/plasmic-design` in Claude Code skill system.

### Acceptance Criteria (from spec)
- [x] Produces higher-quality output than `/plasmic-create-page` or `/plasmic-edit` — 4-phase loop with context gathering, structured planning, per-phase verification
- [x] Detects and self-corrects deviations — Phase 4 inspect.summary comparison with max 2 retries per sub-phase
- [x] Works for both page creation and component editing — Phase 3a handles create-page, create, and edit paths
- [x] No new MCP tools required — uses only existing 8 domain tools
- [x] Auto-retry bounded to max 2 correction attempts per phase; surfaces deviation on failure
- [x] All features in scope: layout, typography, tokens, responsive, data binding, interactions, animations, multi-page/multi-component

---

## Priority 3 — EP Commerce Address Validation Bug (Medium Priority)

**Status:** Not started — confirmed bug
**Location:** `plasmicpkgs/commerce-providers/elastic-path/src/api/utils/validation.ts`

### Bug: Type mismatch between `AddressData` interface and `validateAddressData()` function

**`AddressData` interface** (`checkout/types.ts:12`):
- `line_1`, `postcode`, no `state` field, `county` (optional)

**`validateAddressData()` function** (`api/utils/validation.ts:49`):
- Accesses `address.line1` (should be `line_1`)
- Accesses `address.postalCode` (should be `postcode`)
- Accesses `address.state` (field doesn't exist on `AddressData`; should be `county`)

**Impact:** Validation always fails or crashes at runtime — fields are `undefined`.

### Bug: Missing exports for imported functions

`validate-address.ts:12-13` and `calculate-shipping.ts:13` import `validateBillingAddress` and `validateShippingAddress` from `validation.ts`, but these functions are **never exported** (only `validateAddressData` exists with an `isShipping` boolean parameter).

### Additional issues in same area
- `getAddressSuggestions()` in `validate-address.ts` — dead code, never called, returns `[]`
- `validateAddressBusinessRules()` in `validate-address.ts` — dead code, never called
- `validateRateLimit()` in `validation.ts:259` — stub that always returns `true` (placeholder, not production-ready)

### Fix approach
- Fix field names in `validateAddressData()` to match `AddressData` interface
- Either export `validateBillingAddress`/`validateShippingAddress` wrappers or change imports to use `validateAddressData`
- Remove dead code (`getAddressSuggestions`, `validateAddressBusinessRules`)
- Document rate-limit stub as known limitation

---

## Priority 4 — EP Commerce Test Coverage (Low Priority)

**Status:** Not started
**Location:** `plasmicpkgs/commerce-providers/elastic-path/src/`

~105 of 140 source files have no corresponding test files (75% untested). Breakdown:
- 6 API endpoint handlers untested
- 3 API schema files untested
- 20+ registration files untested (declarative, low risk)
- Checkout components and hooks untested
- 35 test files currently exist covering core logic

Low priority: registration files are declarative, visual components are best validated in Studio. API endpoint handlers are higher priority for testing.

---

## Priority 5 — Address Validation Placeholder (Low Priority)

**Status:** Placeholder implementation
**File:** `plasmicpkgs/commerce-providers/elastic-path/src/api/endpoints/checkout/validate-address.ts`

`normalizeAddress()` is a basic string formatter (comments list integration points: Google Maps, USPS, Loqate, SmartyStreets, HERE). `getAddressSuggestions()` returns empty array (dead code — see P3). Not blocking — requires third-party API key decision outside EP/Plasmic scope.

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
- **EP commerce health:** 0 TODOs, 0 FIXMEs, 40 registered components (2 deprecated), 176 total files (140 source, 35 test). Type mismatch bug in address validation (see P3).
- **plasmic-mcp-registry:** Fully functional at `packages/plasmic-mcp-registry/` — serializes 5 globalThis registries for HTTP transport
- **Existing skills:** 7 files in `.claude/commands/` (plasmic, plasmic-design, plasmic-edit, plasmic-inspect, plasmic-create-component, plasmic-create-page, plasmic-patterns). `/plasmic-design` implements a 4-phase agentic loop; all others are single-pass.
- **Spec:** `.ralph/specs/PLASMIC-DESIGN-AGENT-SKILL.md`
- **P1 spec:** `.ralph/specs/PROJECT-PACKAGE-MANAGEMENT.md` (complete, for reference)
- **Scope:** This plan covers `packages/plasmic-mcp/`, `.claude/commands/`, and EP commerce gaps. Platform/WAB changes are tracked upstream.
- **Build mechanism:** esbuild `build.mjs` already resolves `@/wab/shared/*` to real WAB source files. Unit tests use mocks via Vite aliases. Integration tests use real WAB source.
