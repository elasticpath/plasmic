# Implementation Plan

1 open spec in `.ralph/specs/`. Spec 2 (Expression Safety) completed.
Current branch: `feat/mcp-design-enhancements`. Actual action count: **107** (header says 104).

---

## Spec 2: update-attrs Expression Safety — DONE

Committed as `461a7e390`. All 14 new tests pass alongside full suite (1669 unit, 170 integration).

Changes:
- `validateJsExpression()` using acorn.parseExpressionAt in `edit-tools.ts`
- `checkLiteralWarning()` for dangling `$state.`/`$ctx.` references
- `createAttrExpr(value, warnings)` validates dynamic expressions, collects warnings
- `UpdateAttrsResult` and `UpdatePropsResult` gained `warnings?: string[]`
- `server.ts` handlers surface warnings in JSON response
- 14 new unit tests covering valid/invalid/warning scenarios

---

## Spec 1: Hostless Component Discovery (`hostless-component-discovery.md`)

**Status: TODO** — Priority: MEDIUM (new feature, enables component discovery workflow)

### Current state (confirmed by code analysis)
- `listAvailablePackages()` — **does NOT exist** on current branch
- `listPackageComponents()` — **does NOT exist** on current branch
- `AvailablePackage` type — **does NOT exist** in `types.ts`
- `PackageComponent` type — **does NOT exist** in `types.ts`
- `getAppConfig()` — **does NOT exist** in `api-client.ts`
- Neither action registered in `server.ts`
- No unit tests for either action
- Reference implementations exist on `feat/prod-bootstrap` branch (not merged)

### Actions to implement

| Action | Location | Status |
|--------|----------|--------|
| `project.list-available-packages` | `package-manager.ts` + `server.ts` | TODO |
| `project.list-package-components` | `package-manager.ts` + `server.ts` | TODO |

### Tasks

- [ ] Port `AvailablePackage` and `PackageComponent` types to `types.ts`
  - Source: `feat/prod-bootstrap:packages/plasmic-mcp/src/types.ts`
  - `PackageComponent` must include `props: [{ name, type, required, isSlot, defaultValue, description }]`
- [ ] Add `getAppConfig()` to `api-client.ts`
  - GET `/api/v1/app-config`
  - Currently no such method exists (closest is `getAppAuthPubConfig`)
- [ ] Port `listAvailablePackages()` to `package-manager.ts`
  - Source: `feat/prod-bootstrap:packages/plasmic-mcp/src/package-manager.ts`
  - Calls `apiClient.getAppConfig()`, maps `config.hostLessComponents`, marks `isInstalled`
  - Returns empty array (not error) if endpoint unavailable
- [ ] Implement `listPackageComponents()` in `package-manager.ts` — **extend beyond prod-bootstrap version**
  - Read from `session.site.projectDependencies` (already bundled, no server round-trip)
  - For each installed package: iterate `dep.site.components` filtered by `isReusableComponent`
  - For each component: extract `params` → `props` array with `name`, `type`, `required`, `isSlot`, `defaultValue`, `description`
  - `isSlot`: `!!param.tplSlot || param.typeTag === "SlotParam"`
  - `type`: from `param.typeTag ?? param._type ?? param.type?._type ?? "unknown"`
  - `defaultValue`: serialise `param.defaultExpr?.code` if CustomCode, else omit
  - Support optional `packageName` filter (case-insensitive); throw descriptive error if not found
- [ ] Register both actions in `server.ts` `project` tool
  - Add to `action` enum: `"list-available-packages"`, `"list-package-components"`
  - Add Zod schema for optional `packageName?: string`
  - Add to tool description with few-shot examples
  - Add to `outputSchema` structured content
- [ ] Unit tests in `__tests__/package-manager.test.ts`
  - `listAvailablePackages`: returns catalog with isInstalled; empty on API error
  - `listPackageComponents`: returns props from bundled deps; packageName filter; unknown package error
- [ ] Update action count in tool description (107 → 109 after adding 2 new actions)
  - Also fix header comment: currently says 104, actual count is 107

---

## Notes

- Do not touch upstream WAB files (`platform/wab/src/`)
- Use explicit `git add <files>` — never `git add -A` or `git add .`
- Run `npm run typecheck` after each spec to catch type errors early
- Run `npm test` (full suite) before marking a spec done
- `warnings` pattern: follow `AddChildResult` at `edit-tools.ts:2484-2485` for consistent approach
- Action count discrepancy: header says "104 actions" but actual enum count is 107 (inspect has 10, not 8)
