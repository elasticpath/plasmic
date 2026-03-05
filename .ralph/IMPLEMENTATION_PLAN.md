# Implementation Plan

0 open specs in `.ralph/specs/`. Spec 1 (Hostless Component Discovery) and Spec 2 (Expression Safety) completed.
Current branch: `feat/mcp-design-enhancements`. Actual action count: **109**.

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

## Spec 1: Hostless Component Discovery — DONE

Changes:
- Types added to `types.ts`: `HostLessComponentInfo`, `HostLessPackageInfo`, `AppConfigResponse`, `AvailablePackage`, `PackageComponent` (with `PackageComponentPropInfo`)
- `getAppConfig()` added to `api-client.ts` (GET `/api/v1/app-config`)
- `listAvailablePackages()` in `package-manager.ts`: reads catalog from app-config, marks `isInstalled`, returns empty on API failure
- `listPackageComponents()` in `package-manager.ts`: reads bundled `site.projectDependencies`, extracts full prop schemas including name, type, required, isSlot, defaultValue, description
- `extractComponentProps()` helper for prop derivation from component params
- Both actions registered in `server.ts` project tool (enum expanded to 10 actions)
- `mockIsReusableComponent` added to wab-components mock
- 12 new unit tests (4 for `listAvailablePackages`, 8 for `listPackageComponents` including edge cases)
- Action count updated from 107 to 109 in `server.ts` header

---

## Notes

- Do not touch upstream WAB files (`platform/wab/src/`)
- Use explicit `git add <files>` — never `git add -A` or `git add .`
- Run `npm run typecheck` after each spec to catch type errors early
- Run `npm test` (full suite) before marking a spec done
- `warnings` pattern: follow `AddChildResult` at `edit-tools.ts:2484-2485` for consistent approach
