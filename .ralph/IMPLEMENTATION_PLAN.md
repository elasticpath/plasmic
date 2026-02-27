# @elasticpath/plasmic-mcp-registry -- Implementation Plan

Spec: `.ralph/specs/plasmic-mcp-registry-nextjs-wrapper.md`

Last verified: 2026-02-27 (P1-P5, P27-P31 all complete)

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

## P31 -- Type-safe registryData + hostUrl env var fallback (DONE)

Why: `session.registryData` was typed as `any`, cascading type unsafety to every consumer (server.ts, edit-tools.ts). The spec also requires "Dev host URL sourced from MCP server configuration (environment variable or project settings)" but only project settings were implemented.

- [x] **Strongly-typed `FullRegistryData`**: Replaced `Record<string, unknown>[]` for contexts/functions/tokens/traits with dedicated interfaces (`RegistryContext`, `RegistryFunction`, `RegistryToken`, `RegistryTrait`). Types mirror the canonical interfaces from `@elasticpath/plasmic-mcp-registry` (SerializedContextMeta, etc.) without a runtime dependency.
- [x] **Exported `RegistryComponent`**: Added `defaultStyles`, `parentComponentName`, `props` fields to the interface and exported it for use by `edit-tools.ts`.
- [x] **Type-safe `Session.registryData`**: Changed from `registryData?: any` to `registryData?: FullRegistryData | null` via `import type` from `devhost-sync.js`.
- [x] **`PLASMIC_DEV_HOST_URL` env var fallback**: In `model-loader.ts`, `hostUrl` now falls back to `process.env.PLASMIC_DEV_HOST_URL` when the Plasmic project has no configured host URL. Project settings always take priority.
- [x] **Removed `as any` casts**:
  - `devhost-sync.ts`: removed `(val as any).cssSelector` / `(val as any).displayName` (lines 229-230) — TypeScript now narrows correctly from the typed `variants` record.
  - `server.ts`: removed `(t: any)` in `design.list-tokens` and `(f: any)` in `data.list-functions` — `RegistryToken` and `RegistryFunction` types propagate from session.
  - `edit-tools.ts`: `findRegistryComponent()` now typed as `(RegistryComponent[], string) => RegistryComponent | null`; `plasmicElementToTpl()` registryComponents param typed as `RegistryComponent[]`.
- [x] **Tests**: 4 new tests in `model-loader.test.ts` for hostUrl sourcing: project settings, env var fallback, project takes priority over env var, undefined when neither set.
- [x] **1701 tests passing** (31 suites), build and typecheck clean.

---

## Current Source Code Summary (verified 2026-02-27, updated after P1-P5/P27-P31)

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
- **Typed interfaces**: `RegistryComponent` (exported, with `defaultStyles`, `parentComponentName`, `props` fields), `RegistryContext`, `RegistryFunction`, `RegistryToken`, `RegistryTrait` — all strongly typed, mirror canonical types from `@elasticpath/plasmic-mcp-registry` without runtime dependency. `FullRegistryData` uses these typed arrays instead of `Record<string, unknown>[]`.
- **fetchDevHostRegistry()**: fetches `{hostUrl}/api/plasmic-registry`, 5s timeout, returns `FullRegistryData | null` containing all five registries. Backward-compatible: if response only has `components`, others default to `[]`.
- **TTL cache**: default 60s, configurable via `PLASMIC_REGISTRY_CACHE_TTL_MS` env var. Cache key is normalized `hostUrl`. `clearRegistryCache()` exported and called on `project.refresh`.
- **syncVariantMetadata()**: overwrites CC variant metadata from registry (dev host is source of truth)
- **ensureVariantObjects()**: creates missing variant objects on wrapper components
- **syncFromDevHost()**: orchestrator called from 5 locations in server.ts. `SyncResult` now includes `registryData: FullRegistryData | null`, stored in session after sync.
- **`getCodeComponentVariantMetas()`**: uses `tplTree?.typeTag ?? tplTree?._type` (fixed from `_type` only)

### packages/plasmic-mcp/src/edit-tools.ts (P27-P29, P31 changes)
- **`findRegistryComponent()`**: typed `(RegistryComponent[], string) => RegistryComponent | null`; matches by name with `$dev` suffix handling (P31: import from devhost-sync.ts)
- **`plasmicElementToTpl()`**: accepts optional `registryComponents?: RegistryComponent[]` parameter; applies `defaultStyles` from registry after `mkTplComponentX` creates TplComponent instances; populates slot `defaultValue` from registry for unfilled slots (recursively converts PlasmicElement trees to TplNodes and wires as `Arg` + `RenderExpr`)
- **`addChild()`**: passes `session.registryData?.components` to `plasmicElementToTpl`; validates `parentComponentName` from registry and returns non-fatal `warnings[]`
- **`AddChildResult`**: new optional `warnings?: string[]` field for parentComponentName mismatches

### packages/plasmic-mcp/src/server.ts (P27-P31 changes)
- **`component.create-page`**, **`component.create`**, **`component.clone`**: `setSession()` calls now include `registryData: syncResult.registryData` (was missing, causing session.registryData to become undefined after these operations)
- **`node.add` handler**: surfaces `result.warnings` in JSON response (both normal and dry-run modes)
- **`data.list-functions` handler**: enriched result built with spread pattern; `(f: any)` casts removed (P31 — `RegistryFunction` type flows from session)
- **`design.list-tokens` handler**: enriched result built with spread pattern; `(t: any)` casts removed (P31 — `RegistryToken` type flows from session)

### packages/plasmic-mcp/src/session.ts
- **`Session.registryData`**: typed as `FullRegistryData | null` via `import type` from `devhost-sync.js` (P31; was `any` in P27). Provides type safety to all consumers.
- Populated after each `syncFromDevHost()` call; cleared on `set-project` cleanup
- Consumed by `design.list-tokens` (devHostTokens), `data.list-functions` (devHostFunctions), `project.set`/`project.refresh` summary responses, and `addChild` (defaultStyles + parentComponentName validation)

### packages/plasmic-mcp/src/model-loader.ts (P31 change)
- **`hostUrl` resolution**: `response.project?.hostUrl ?? process.env.PLASMIC_DEV_HOST_URL` — project settings take priority, env var provides fallback for projects without a configured host URL

### Test counts (as of P1-P5/P27-P31 completion)
- packages/plasmic-mcp-registry: 75 tests (5 suites)
- plasmicpkgs-dev: 6 tests (1 suite) -- all passing
- packages/plasmic-mcp: 1701 tests (31 suites) -- all passing
  - model-loader.test.ts: added 4 tests for P31 hostUrl sourcing (project settings, env var fallback, project priority over env, undefined when neither)
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
