# @elasticpath/plasmic-mcp-registry -- Implementation Plan

Spec: `.ralph/specs/plasmic-mcp-registry-nextjs-wrapper.md`

Last verified: 2026-02-27 (P1-P5, P27-P30 all complete)

---

## P1 -- Foundation (DONE)

- [x] Package rename `plasmic-registry` -> `plasmic-mcp-registry`, npm name -> `@elasticpath/plasmic-mcp-registry` v0.2.0
- [x] New types: `SerializedContextMeta`, `SerializedFunctionMeta`, `TokenRegistration`/`TokenType`, `TraitRegistration`/`BasicTrait`/`ChoiceTrait`, `FullRegistryResponse`
- [x] Package `"exports"` field with `"."` and `"./next"` subpaths

---

## P2 -- Core Functionality (DONE)

- [x] `serializeContextMeta()`, `getContextRegistry()` -- strips function callbacks, JSON roundtrip, defensive null guards
- [x] `serializeFunctionMeta()`, `getFunctionRegistry()` -- strips `fnContext`, JSON roundtrip, defensive null guards
- [x] `getTokenRegistry()`, `getTraitRegistry()` -- pass-through (fully serializable), defensive null guards
- [x] `getFullRegistry()` -- convenience wrapper calling all five readers
- [x] Updated `index.ts` exports (6 readers, 3 serializers, all types)
- [x] Tests: 75 tests (5 suites) -- 21 existing + 54 new

---

## P3 -- Integration (DONE)

- [x] `withPlasmicRegistry()` in `src/next.ts` -- auto-detects `@plasmicpkgs/*`, `@elasticpath/plasmic-*`, `@plasmicapp/host` and merges into `serverExternalPackages`
- [x] `plasmicpkgs-dev/next.config.js` wrapped with `withPlasmicRegistry()`
- [x] `plasmicpkgs-dev/app/api/plasmic-registry/route.ts` updated to call `getFullRegistry()` and return `FullRegistryResponse`
- [x] `plasmicpkgs-dev` test suite updated (mock `getFullRegistry`, assert full `FullRegistryResponse` shape)
- [x] Tests: 11 tests for `withPlasmicRegistry()`, 6 route handler tests updated

---

## P4 -- MCP Server Consumption (DONE)

- [x] `fetchDevHostRegistry()` parses `FullRegistryResponse` (backward-compatible; missing registries default to `[]`)
- [x] TTL cache (default 60s, `PLASMIC_REGISTRY_CACHE_TTL_MS` env var, invalidated on `project.refresh`)
- [x] `session.registryData` stores all five registries; `design.list-tokens` enriched with `devHostTokens`; `data.list-functions` enriched with `devHostFunctions`; `project.set`/`project.refresh` responses include `devHostRegistry` summary

---

## P5 -- Bug Fixes and Polish (DONE)

- [x] Fixed `getCodeComponentVariantMetas` to use `tplTree?.typeTag ?? tplTree?._type` (was `_type` only, silently failed on real WAB instances)
- [x] Fixed `registerShopify` asymmetry in `plasmicpkgs-dev` (missing call in `plasmic-init-client.tsx`)
- [x] Verified defensive `try/catch` fallback in `serializeContextMeta` and `serializeFunctionMeta`

---

## P27 -- MCP Server Registry Enrichment (DONE)

- [x] `session.registryData: FullRegistryData | null` field added; populated after every `syncFromDevHost()` call, cleared on `set-project` cleanup
- [x] `design.list-tokens` response enriched with `devHostTokens` from registry
- [x] `data.list-functions` response enriched with `devHostFunctions` from registry
- [x] `project.set` and `project.refresh` responses include `devHostRegistry` summary (`{ contextCount, functionCount, tokenCount, traitCount }`)

---

## P28 -- Registry-Enriched Component Creation (DONE)

- [x] Fixed `registryData` dropped from session in `component.create-page`, `component.create`, `component.clone` `setSession()` calls
- [x] `plasmicElementToTpl()` applies `defaultStyles` from registry via `RSH.merge(sanitizeStyles(...))` when creating TplComponent instances; `findRegistryComponent()` helper handles `$dev` suffix matching
- [x] `addChild()` validates `parentComponentName` from registry; non-blocking warning returned in `AddChildResult.warnings[]` and surfaced in `node.add` JSON response
- [x] `plasmicElementToTpl()` populates slot `defaultValue` from registry for unfilled slots (children and named slots); explicit children take priority; non-fatal on conversion failure
- [x] Tests: 3 server.test.ts for `node.add` warnings + 3 for `registryData` preservation + 11 node.test.ts for registry enrichment (defaultStyles, $dev suffix, parentComponentName, slot defaults)

---

## P29 -- Slot Default Value Population + registerShopify Fix (DONE)

- [x] Slot `defaultValue` population in `plasmicElementToTpl()` (see P28 fourth bullet -- committed as part of P29 git tag)
- [x] Fixed `registerShopify` asymmetry in `plasmicpkgs-dev`: `plasmic-init-client.tsx` was missing the `registerShopify(PLASMIC)` call present in `plasmic-init-server.ts`

---

## P30 -- Type Safety Fixes (DONE)

- [x] Fix: `ListCustomFunctionsResult` type error in `server.ts` `data.list-functions` handler -- interface without index signature was being assigned to `Record<string, unknown>`. Fixed by using spread pattern to build enriched result object.
- [x] Fix: Consistency improvement in `design.list-tokens` handler -- same `Record<string, unknown>` widening pattern replaced with spread pattern for consistency and type robustness.

---

## Current Source Code Summary (verified 2026-02-27, updated after P1-P5/P27-P30)

### packages/plasmic-mcp-registry/ (renamed from plasmic-registry)
- **package.json**: name `@elasticpath/plasmic-mcp-registry`, v0.2.0, zero runtime deps, CommonJS output, `exports` field with `"."` and `"./next"` subpaths
- **src/types.ts**: `SerializedComponentMeta` (30+ fields), `RegistryResponse` (components-only), `SerializedContextMeta`, `SerializedFunctionMeta`, `TokenRegistration`, `TokenType`, `BasicTrait`, `ChoiceTrait`, `TraitRegistration`, `FullRegistryResponse`
- **src/serialize.ts**: `serializeComponentMeta()`, `serializeContextMeta()`, `serializeFunctionMeta()` -- all with null guard + try/catch fallback
- **src/read-registry.ts**: `getComponentRegistry()`, `getContextRegistry()`, `getFunctionRegistry()`, `getTokenRegistry()`, `getTraitRegistry()`, `getFullRegistry()`
- **src/next.ts**: `withPlasmicRegistry()` -- auto-detects Plasmic packages from consumer's `package.json`, merges into `serverExternalPackages`
- **src/index.ts**: re-exports all public API (6 reader functions, 3 serializers, all types)
- **Tests**: 12 serialize + 9 read-registry + 54 new (context/function/token/trait/full readers and serializers) = 75 tests (5 suites)

### plasmicpkgs-dev/
- **next.config.js**: wrapped with `withPlasmicRegistry()` from `@elasticpath/plasmic-mcp-registry/next` -- auto-adds `serverExternalPackages`
- **app/api/plasmic-registry/route.ts**: imports `getFullRegistry` from `@elasticpath/plasmic-mcp-registry`, returns full `FullRegistryResponse` shape (`{ components, contexts, functions, tokens, traits }`)
- **plasmic-init-server.ts**: server-safe registration file, populates globalThis registries (includes `registerShopify`)
- **plasmic-init-client.tsx**: `"use client"` registration (includes `registerShopify`, fixed in P29)
- **package.json**: deps include `@elasticpath/plasmic-mcp-registry`, 8 `@plasmicpkgs/*` packages, `@plasmicapp/loader-nextjs`
- **Tests**: 6 route handler tests in `__tests__/plasmic-registry-route.test.ts` -- updated to mock `getFullRegistry` and assert full `FullRegistryResponse` shape

### packages/plasmic-mcp/src/devhost-sync.ts
- **fetchDevHostRegistry()**: fetches `{hostUrl}/api/plasmic-registry`, 5s timeout, returns `FullRegistryData | null` containing all five registries. Backward-compatible: if response only has `components`, others default to `[]`.
- **TTL cache**: default 60s, configurable via `PLASMIC_REGISTRY_CACHE_TTL_MS` env var. Cache key is normalized `hostUrl`. `clearRegistryCache()` exported and called on `project.refresh`.
- **syncVariantMetadata()**: overwrites CC variant metadata from registry (dev host is source of truth)
- **ensureVariantObjects()**: creates missing variant objects on wrapper components
- **syncFromDevHost()**: orchestrator called from 5 locations in server.ts. `SyncResult` now includes `registryData: FullRegistryData | null`, stored in session after sync.
- **`getCodeComponentVariantMetas()`**: uses `tplTree?.typeTag ?? tplTree?._type` (fixed from `_type` only)
- **Contexts/functions/tokens/traits**: parsed from `FullRegistryData` and stored in `session.registryData` for use by MCP tool handlers

### packages/plasmic-mcp/src/edit-tools.ts (P27-P29 changes)
- **`findRegistryComponent()`**: matches registry component entries by name with `$dev` suffix handling
- **`plasmicElementToTpl()`**: now accepts optional `registryComponents` parameter; applies `defaultStyles` from registry after `mkTplComponentX` creates TplComponent instances; populates slot `defaultValue` from registry for unfilled slots (recursively converts PlasmicElement trees to TplNodes and wires as `Arg` + `RenderExpr`)
- **`addChild()`**: passes `session.registryData?.components` to `plasmicElementToTpl`; validates `parentComponentName` from registry and returns non-fatal `warnings[]`
- **`AddChildResult`**: new optional `warnings?: string[]` field for parentComponentName mismatches

### packages/plasmic-mcp/src/server.ts (P27-P30 changes)
- **`component.create-page`**, **`component.create`**, **`component.clone`**: `setSession()` calls now include `registryData: syncResult.registryData` (was missing, causing session.registryData to become undefined after these operations)
- **`node.add` handler**: surfaces `result.warnings` in JSON response (both normal and dry-run modes)
- **`data.list-functions` handler**: enriched result built with spread pattern (fixes `ListCustomFunctionsResult` type error -- interface lacks index signature; P30)
- **`design.list-tokens` handler**: enriched result built with spread pattern for consistency and type robustness (P30)

### packages/plasmic-mcp/src/session.ts
- **`Session`** now has `registryData: FullRegistryData | null` field (added in P27)
- Populated after each `syncFromDevHost()` call; cleared on `set-project` cleanup
- Consumed by `design.list-tokens` (devHostTokens), `data.list-functions` (devHostFunctions), `project.set`/`project.refresh` summary responses, and `addChild` (defaultStyles + parentComponentName validation)

### Test counts (as of P1-P5/P27-P30 completion)
- packages/plasmic-mcp-registry: 75 tests (5 suites)
- plasmicpkgs-dev: 6 tests (1 suite) -- all passing
- packages/plasmic-mcp: 1697 tests (31 suites) -- all passing
  - devhost-sync.test.ts: 35 tests (added 4 for P27 registryData in SyncResult)
  - server.test.ts: 267 tests (added 6 for P28: 3 node.add warnings + 3 registryData preservation)
  - node.test.ts: added 11 tests for P28/P29 registry enrichment (defaultStyles, $dev matching, no registryData, parentComponentName mismatch/match/TplTag, slot defaultValue population, named slot defaults, explicit children override, missing slot skip, non-slot prop handling)

### Host registration global shapes (packages/host/src/register*.ts)
| Registry | Global | Entry Shape | Non-serializable |
|----------|--------|-------------|-----------------|
| Components | `__PlasmicComponentRegistry` | `{ component, meta }` | `component` (React), 6 meta fields, nested fn callbacks in props/states |
| Contexts | `__PlasmicContextRegistry` | `{ component, meta }` | `component` (React), nested fn callbacks in props, globalActions params |
| Functions | `__PlasmicFunctionsRegistry` | `{ function, meta }` | `function` (the fn), `meta.fnContext` |
| Tokens | `__PlasmicTokenRegistry` | `TokenRegistration` directly | NONE (fully serializable) |
| Traits | `__PlasmicTraitRegistry` | `{ trait, meta }` | NONE (fully serializable) |
