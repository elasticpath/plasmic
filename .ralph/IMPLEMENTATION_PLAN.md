# @elasticpath/plasmic-mcp-registry -- Implementation Plan

Spec: `.ralph/specs/plasmic-mcp-registry-nextjs-wrapper.md`

Last verified: 2026-02-27 (updated after P1, P2, P3, P4, and partial P5 completion)

---

## P1 -- Foundation (types, package structure)

These items establish the package identity and type contracts that everything else depends on.

- [x] `SerializedComponentMeta` type (`packages/plasmic-registry/src/types.ts`)
  - 30+ fields including `variants`, `props`, `states`, `figmaMappings`, `styleSections`, index signature for extra JSON-safe fields
- [x] `RegistryResponse` type (components-only shape `{ components: SerializedComponentMeta[] }`, will be superseded by `FullRegistryResponse`)
- [x] **Package rename**: directory `packages/plasmic-registry/` -> `packages/plasmic-mcp-registry/`, npm name -> `@elasticpath/plasmic-mcp-registry`, version bumped to 0.2.0
  - Update `package.json` name field (currently `@elasticpath/plasmic-registry`)
  - Update `plasmicpkgs-dev/package.json` dependency reference
  - Update `plasmicpkgs-dev/app/api/plasmic-registry/route.ts` import (currently `import { getComponentRegistry } from "@elasticpath/plasmic-registry"`)
  - Update `plasmicpkgs-dev/__tests__/plasmic-registry-route.test.ts` mock (currently `vi.mock("@elasticpath/plasmic-registry", ...)`)
  - Update any workspace/monorepo references
  - Rationale: must happen first so all new code uses the correct package name; existing tests must still pass after rename
- [x] **New types**: `SerializedContextMeta` -- mirrors `GlobalContextMeta` minus `component` ref and function fields
  - Fields to preserve: `name`, `displayName?`, `description?`, `importName?`, `importPath`, `isDefaultExport?`, `refProp?`, `providesData?`, `props` (with functions stripped), `globalActions` (with function-bearing `parameters[].type` stripped)
  - Non-serializable: `component` ref is at entry level (same pattern as components); props may contain function callbacks (`hidden`, `validator`, `control`, `options`, `defaultValueHint`, `readOnly`, `onSearch`)
  - Depends on: package rename (so file lives in correct package)
- [x] **New types**: `SerializedFunctionMeta` -- mirrors `CustomFunctionMeta` minus `function` ref and `fnContext` callback
  - Fields to preserve: `name`, `namespace?`, `displayName?`, `description?`, `typescriptDeclaration?`, `isQuery?`, `importPath`, `isDefaultExport?`, `params?`, `returnValue?`
  - Non-serializable: `function` ref is at entry level (not meta level); `meta.fnContext` is a function returning `{ dataKey, fetcher }`
  - Depends on: package rename
- [x] **New types**: `TokenRegistration` with `TokenType` -- define local equivalent of `@plasmicapp/host/registerToken`'s `TokenRegistration`
  - Shape: `{ name: string, value: string, type: TokenType, displayName?: string, selector?: string }` where `TokenType = "color" | "spacing" | "font-family" | "font-size" | "line-height" | "opacity"`
  - Note: already fully serializable, no stripping needed. Entries are stored DIRECTLY in the global array (no `{ meta }` wrapper -- unlike the other registries)
  - Decision: define local interfaces (zero deps on `@plasmicapp/host`, same approach as `SerializedComponentMeta`)
  - Depends on: package rename
- [x] **New types**: `TraitRegistration` with `BasicTrait` and `ChoiceTrait` -- define local equivalent of `@plasmicapp/host/registerTrait`'s `TraitRegistration`
  - Shape: `{ trait: string, meta: TraitMeta }` where `TraitMeta = BasicTrait | ChoiceTrait`
  - `BasicTrait = { label?: string, type: "text" | "number" | "boolean" }`
  - `ChoiceTrait = { label?: string, type: "choice", options: string[] }` (options is a plain `string[]`, NOT a function unlike `ChoiceType` in prop types)
  - Note: already fully serializable, no stripping needed
  - Depends on: package rename
- [x] **New types**: `FullRegistryResponse` -- `{ components: SerializedComponentMeta[], contexts: SerializedContextMeta[], functions: SerializedFunctionMeta[], tokens: TokenRegistration[], traits: TraitRegistration[] }`
  - Supersedes `RegistryResponse` (which only has `components`)
  - Depends on: all five type definitions above
- [x] **Package `"exports"` field** added with both `"."` and `"./next"` subpaths

---

## P2 -- Core Functionality (registry readers + serialization)

Registry readers and their serialization logic. Each reader follows the same pattern as the existing `getComponentRegistry()`: read from `globalThis`, serialize, return typed array.

- [x] `serializeComponentMeta()` -- strips 6 top-level fields (`figmaPropsTransform`, `treeLabel`, `componentHelpers`, `refActions`, `actions`, `templates`) + top-level functions + JSON roundtrip for nested function stripping
  - Located in `packages/plasmic-registry/src/serialize.ts`
  - Has `try/catch` with `{ name: "" }` fallback on circular reference or JSON.stringify failure
- [x] `getComponentRegistry()` -- reads `__PlasmicComponentRegistry`, destructures `{ meta }` from each entry (discarding `component` ref), calls `serializeComponentMeta(meta)`, returns `SerializedComponentMeta[]`
  - Located in `packages/plasmic-registry/src/read-registry.ts`
- [x] **`serializeContextMeta()`** -- strips nested function callbacks in `props`, function refs in `globalActions[].parameters`, then JSON roundtrip
  - Key insight: `GlobalContextMeta.props` entries may contain callback functions (`hidden`, `validator`, `control`, `options` when function, `defaultValueHint`, `readOnly`, `onSearch`). JSON roundtrip strips these. `globalActions` entries have `parameters` arrays containing `FunctionParam` which may have function fields.
  - Implementation: no explicit top-level fields to strip (unlike components which have 6 explicit fields). The `component` ref is at entry level, handled by the reader. Just needs JSON roundtrip + null guard + try/catch fallback.
  - Depends on: `SerializedContextMeta` type (P1)
- [x] **`getContextRegistry()`** -- reads `globalThis.__PlasmicContextRegistry`, destructures `{ meta }` from each entry (discarding `component` ref), maps through `serializeContextMeta(entry.meta)`, returns `SerializedContextMeta[]`
  - Defensive: return `[]` if global is null/undefined/not-array
  - Depends on: `serializeContextMeta()`
- [x] **`serializeFunctionMeta()`** -- strips `fnContext` from meta (a callback returning `{ dataKey, fetcher }`), then JSON roundtrip
  - Key insight: `fnContext` is the only explicitly non-serializable field on `CustomFunctionMeta` itself. The `function` ref is at entry level (not meta level), handled by the reader. `params` array entries may have function fields (`control`, `hidden`) -- JSON roundtrip handles these.
  - Depends on: `SerializedFunctionMeta` type (P1)
- [x] **`getFunctionRegistry()`** -- reads `globalThis.__PlasmicFunctionsRegistry`, destructures `{ meta }` from each entry (discarding `function` ref), maps through `serializeFunctionMeta(entry.meta)`, returns `SerializedFunctionMeta[]`
  - Defensive: return `[]` if global is null/undefined/not-array
  - Depends on: `serializeFunctionMeta()`
- [x] **`getTokenRegistry()`** -- reads `globalThis.__PlasmicTokenRegistry`, returns `TokenRegistration[]` as-is (no serialization needed -- flat shape with name/value/type/displayName/selector, already JSON-safe)
  - Defensive: return `[]` if global is null/undefined
  - Note: token entries are stored DIRECTLY in the array (no `{ meta }` wrapper). Each entry IS the `TokenRegistration`.
  - Depends on: `TokenRegistration` type (P1)
- [x] **`getTraitRegistry()`** -- reads `globalThis.__PlasmicTraitRegistry`, returns `TraitRegistration[]` as-is (no serialization needed -- fully serializable, `ChoiceTrait.options` is plain `string[]`)
  - Defensive: return `[]` if global is null/undefined
  - Note: entries have shape `{ trait: string, meta: TraitMeta }`. Unlike tokens, traits DO have a meta wrapper.
  - Depends on: `TraitRegistration` type (P1)
- [x] **`getFullRegistry()`** -- convenience function calling all five readers, returns `FullRegistryResponse`
  - Depends on: all five reader functions above + `FullRegistryResponse` type (P1)
- [x] **Update `index.ts` exports** -- export all new readers, serializers, and types from the package root
  - Currently exports: `getComponentRegistry`, `serializeComponentMeta`, `SerializedComponentMeta`, `RegistryResponse`
  - Add: `getContextRegistry`, `getFunctionRegistry`, `getTokenRegistry`, `getTraitRegistry`, `getFullRegistry`, `serializeContextMeta`, `serializeFunctionMeta`, `SerializedContextMeta`, `SerializedFunctionMeta`, `TokenRegistration`, `TraitRegistration`, `FullRegistryResponse`
  - Depends on: all reader functions

### P2 Tests

- [x] Existing `serialize.test.ts` (12 test cases for `serializeComponentMeta`)
- [x] Existing `read-registry.test.ts` (9 test cases for `getComponentRegistry`)
- [x] Unit tests for `serializeContextMeta()` -- 9 test cases (preserves fields, strips function callbacks in props, strips globalActions functions, null/undefined/non-object input, empty meta, circular reference fallback, top-level functions)
- [x] Unit tests for `getContextRegistry()` -- 5 test cases (empty, not array, correct shape, strips component ref, malformed entries)
- [x] Unit tests for `serializeFunctionMeta()` -- 9 test cases (preserves fields, strips fnContext, strips function params, null/undefined/non-object, empty, circular, top-level functions)
- [x] Unit tests for `getFunctionRegistry()` -- 5 test cases (empty, not array, correct shape, strips function ref and fnContext, malformed entries)
- [x] Unit tests for `getTokenRegistry()` -- 4 test cases (empty, not array, preserves all fields, filters malformed, all token types)
- [x] Unit tests for `getTraitRegistry()` -- 4 test cases (empty, not array, BasicTrait, ChoiceTrait, filters malformed)
- [x] Unit tests for `getFullRegistry()` -- 3 test cases (all five populated, all empty, mixed)

---

## P3 -- Integration (Next.js wrapper, package exports, consumer updates)

The Next.js config wrapper and consumer-side wiring in `plasmicpkgs-dev`.

- [x] **`withPlasmicRegistry()` function** -- new file `src/next.ts`, exported from `@elasticpath/plasmic-mcp-registry/next` subpath
  - Reads consumer's `package.json` (via `fs.readFileSync` + `JSON.parse`, relative to `process.cwd()`)
  - Auto-detects dependencies matching: `@plasmicpkgs/*`, `@elasticpath/plasmic-*`, `@plasmicapp/host`
  - Scans both `dependencies` and `devDependencies`
  - Merges detected packages into `config.serverExternalPackages` (deduplicates)
  - Returns the merged NextConfig
  - Zero Next.js npm dependency -- uses only Node.js built-ins (`fs`, `path`)
  - `console.warn` if `package.json` cannot be read; proceeds without auto-detected packages
  - Depends on: package rename (P1)
- [x] **Package `"exports"` field in `package.json`** -- both `"."` and `"./next"` subpaths with types/require/import conditions
  - `"."` -> `{ "import": "./dist/index.js", "types": "./dist/index.d.ts" }`
  - `"./next"` -> `{ "import": "./dist/next.js", "types": "./dist/next.d.ts" }`
  - Depends on: `withPlasmicRegistry()` implementation
- [x] **Update `plasmicpkgs-dev/next.config.js`** -- wrap with `withPlasmicRegistry()`:
  ```js
  const { withPlasmicRegistry } = require("@elasticpath/plasmic-mcp-registry/next");
  module.exports = withPlasmicRegistry({ reactStrictMode: true });
  ```
  - Currently has NO `serverExternalPackages` -- the wrapper will add them
  - Depends on: `withPlasmicRegistry()` + package exports
- [x] **Update `plasmicpkgs-dev/app/api/plasmic-registry/route.ts`** -- change import from `@elasticpath/plasmic-registry` to `@elasticpath/plasmic-mcp-registry`, call `getFullRegistry()` instead of `getComponentRegistry()`, return `FullRegistryResponse` shape
  - Currently: `import { getComponentRegistry } from "@elasticpath/plasmic-registry"` → `return Response.json({ components: getComponentRegistry() })`
  - Now: `import { getFullRegistry } from "@elasticpath/plasmic-mcp-registry"` → `return Response.json(getFullRegistry())`
  - Depends on: package rename (P1) + `getFullRegistry()` (P2)
- [x] **Update `plasmicpkgs-dev` test suite** -- existing route handler tests (6 cases in `__tests__/plasmic-registry-route.test.ts`) must be updated
  - Update mock from `@elasticpath/plasmic-registry` to `@elasticpath/plasmic-mcp-registry`
  - Update expected response shape from `{ components }` to `{ components, contexts, functions, tokens, traits }`
  - Mock `getFullRegistry` instead of `getComponentRegistry`
  - Depends on: route.ts update

### P3 Tests

- [x] Unit tests for `withPlasmicRegistry()` -- 11 test cases (auto-detect `@plasmicpkgs/*`, auto-detect `@elasticpath/plasmic-*`, auto-detect `@plasmicapp/host`, scans devDependencies, excludes non-Plasmic packages, merges with existing serverExternalPackages no dupes, empty config `{}`, no config arg, passes through other keys, no packages found, console.warn on read failure)

---

## P4 -- MCP Server Consumption

Updates to `packages/plasmic-mcp/src/devhost-sync.ts` to consume the full registry.

- [x] **Parse `FullRegistryResponse`** in `fetchDevHostRegistry()` -- currently only reads `data.components` and returns `RegistryComponent[] | null`. Should parse and return the full `{ components, contexts, functions, tokens, traits }` shape.
  - Backward-compatible: if the response only has `components` (old endpoint), fill others with `[]`
  - Currently 5 call sites in `server.ts`: `project.set` (line 276), `project.refresh` (line 419), `component.create-page` (line 1156), `component.create` (line 1250), `component.clone` (line 1369)
  - Depends on: `FullRegistryResponse` type definition (P1, though devhost-sync can define its own interface)
- [x] **In-memory cache with configurable TTL** for `fetchDevHostRegistry()` results
  - Added TTL cache (default 60s, configurable via `PLASMIC_REGISTRY_CACHE_TTL_MS` env var)
  - Cache key: normalized `hostUrl`
  - Cache invalidated on: explicit refresh (`project.refresh`), TTL expiry
  - `clearRegistryCache()` exported and called on `project.refresh`; `server.ts` imports `clearRegistryCache` and calls it before `syncFromDevHost` on refresh
  - Depends on: nothing (can be implemented independently)
- [x] **Use contexts, functions, tokens, traits from registry** -- registry data is now stored in the session and surfaced via MCP tool responses:
  - Registry data stored in `session.registryData` after each `syncFromDevHost()` call
  - `design.list-tokens` enriched with `devHostTokens` from registry (color/spacing/font tokens visible to the model)
  - `data.list-functions` enriched with `devHostFunctions` from registry (custom function signatures visible to the model)
  - `project.set` and `project.refresh` responses include `devHostRegistry` summary: `{ contextCount, functionCount, tokenCount, traitCount }`
  - Depends on: `FullRegistryResponse` parsing above

---

## P5 -- Bug Fixes and Polish

Correctness issues and hardening that should be addressed but are not blocking the main feature.

- [x] **Bug: `getCodeComponentVariantMetas` uses `_type` instead of `typeTag`** (`edit-tools.ts:1145`)
  - Fixed: `getCodeComponentVariantMetas()` now uses `tplTree?.typeTag ?? tplTree?._type` pattern, matching `findWrapperComponents` in `devhost-sync.ts`
  - Impact: `getCodeComponentVariantMetas` previously silently returned `null` on real WAB instances; now correctly handles both `typeTag` (real WAB) and `_type` (mocked/plain objects)
  - Depends on: nothing (standalone fix)
- [x] **Fix `registerShopify` asymmetry** in `plasmicpkgs-dev` -- `registerShopify(PLASMIC)` was called in `plasmic-init-server.ts` but the corresponding call was missing from `plasmic-init-client.tsx` (the import was present but the call was absent). Fixed by adding the missing call. This was a bug introduced in P19 when the server-side gap was fixed but the client-side was not mirrored.
- [x] **Defensive JSON handling in new serializers** -- ensure `serializeContextMeta` and `serializeFunctionMeta` have the same `try/catch` fallback as `serializeComponentMeta` (returns `{ name: "" }` on circular reference or JSON.stringify failure)
  - Already implemented -- all three serializers have `try/catch` with `{ name: "" }` fallback

---

## P28 -- Registry-Enriched Component Creation (node.add)

When the MCP server adds a code component instance to a page via `node.add`, it should use registry metadata to enrich the created instance. This addresses three spec acceptance criteria that were previously unimplemented.

- [x] **Bug fix: `registryData` dropped from session in `component.create-page`, `component.create`, and `component.clone` handlers**
  - These three handlers call `syncFromDevHost()` after reloading the project model, but their `setSession()` calls omitted `registryData: syncResult.registryData`. This caused `session.registryData` to become `undefined` after any page/component creation or clone, silently breaking `design.list-tokens` devHostTokens and `data.list-functions` devHostFunctions enrichment.
  - Fixed by adding `registryData: syncResult.registryData` to all three `setSession()` calls, matching the correct pattern in `project.set` and `project.refresh`.
  - Why this matters: without this fix, any operation after create-page/create/clone would lose access to dev host tokens, functions, and other registry data.

- [x] **Apply `defaultStyles` from registry when adding code component instances**
  - When `plasmicElementToTpl()` creates a TplComponent, it now looks up the component in `session.registryData.components` and applies `defaultStyles` via `RSH.merge(sanitizeStyles(...))`.
  - `findRegistryComponent()` helper matches by name with `$dev` suffix handling (strips `$dev` from both registry and site model names before comparing).
  - Registry data is threaded through `plasmicElementToTpl()` as an optional `registryComponents` parameter, passed from `addChild()` which reads it from `session.registryData?.components`.
  - Non-fatal: if `ensureBaseVariantSetting` or RSH.merge fails, a warning is logged and the component is created without default styles.
  - Why this matters: code components often register `defaultStyles` (e.g., width, padding, display) that make instances render correctly. Without this, users must manually set these styles every time.

- [x] **Validate `parentComponentName` when adding component instances**
  - When `addChild()` processes a component-type child element, it checks the registry for `parentComponentName` on the child component.
  - If the parent doesn't match, a warning is returned in `AddChildResult.warnings[]` and logged to stderr.
  - Validation is non-blocking: the component is still added (the user might have a valid reason), but the warning alerts them to potential misuse.
  - Handles `$dev` suffix in both parent and child names.
  - Three cases: TplComponent parent matches (no warning), TplComponent parent doesn't match (warning), TplTag parent (warning about non-component container).
  - `node.add` handler surfaces `warnings` in the JSON response for both normal and dry-run modes.
  - Why this matters: components like AccordionItem are designed to only work inside Accordion. Without validation, the AI model might place them in arbitrary containers, causing rendering issues.

- [x] **Populate slot `defaultValue` from registry when creating component instances**
  - When `plasmicElementToTpl()` creates a TplComponent, it now iterates registry `props` for slot-type entries with `defaultValue`. For each slot that has no explicit content, it recursively converts the `defaultValue` PlasmicElement(s) to TplNodes via `plasmicElementToTpl` and wires them as `Arg` + `RenderExpr` in the base variant setting.
  - Handles all slot types: `children` (default slot), named slots (`header`, `footer`, etc.)
  - Explicit children from the user take priority — defaults are only applied to unfilled slots.
  - Non-slot props with `defaultValue` are correctly ignored (only `type: "slot"` props are processed).
  - Slots referenced in registry but absent from the WAB model are silently skipped.
  - Non-fatal: if conversion fails (e.g., defaultValue references a missing component), a warning is logged and the slot is left empty.
  - Parent pointers set correctly for tree traversal.
  - Spec reference: "Populate default slot content (from `props.children.defaultValue`)"
  - Why this matters: components like Button or Card register meaningful default slot content (e.g., "Click me" text). Without this, every new instance renders empty, requiring the user to manually add content that the component author already provided.

### P28 Tests

- [x] server.test.ts: 3 tests for `node.add` warning surface (with warnings, without warnings, dry-run with warnings)
- [x] server.test.ts: 3 tests for `registryData` preservation in `component.create-page`, `component.create`, `component.clone` (verify `setSession` called with `registryData`)
- [x] node.test.ts: 11 tests for registry enrichment in `addChild`:
  - applies defaultStyles from registry
  - matches registry components with $dev suffix
  - works normally without registryData
  - returns warning for parentComponentName mismatch
  - no warning when parentComponentName matches
  - returns warning when adding to TplTag parent with parentComponentName
  - populates slot defaultValue from registry when no explicit children provided
  - populates named slot defaults from registry (multiple slots)
  - does not override explicit children with slot defaults
  - skips slot defaults for slots that don't exist in WAB model
  - handles non-slot props with defaultValue without treating them as slots

---

## Dependency Graph Summary

```
P1: Package rename
 |
 +-> P1: New types (SerializedContextMeta, SerializedFunctionMeta, TokenRegistration, TraitRegistration, FullRegistryResponse)
      |
      +-> P2: Serializers (serializeContextMeta, serializeFunctionMeta)
      |    |
      |    +-> P2: Readers (getContextRegistry, getFunctionRegistry, getTokenRegistry, getTraitRegistry)
      |         |
      |         +-> P2: getFullRegistry()
      |              |
      |              +-> P3: Package exports ("." and "./next")
      |              |
      |              +-> P3: plasmicpkgs-dev route.ts update
      |              |
      |              +-> P4: MCP server FullRegistryResponse parsing
      |
      +-> P3: withPlasmicRegistry() (independent of readers, only needs package identity)
           |
           +-> P3: plasmicpkgs-dev next.config.js update

P4: TTL cache (independent, can be done anytime)

P5: _type/typeTag bug (independent, can be done anytime)
```

---

## Suggested Implementation Order

1. ~~Package rename (P1) -- establishes correct identity for all subsequent work~~ **DONE**
2. ~~New types (P1) -- type contracts for all new code~~ **DONE**
3. ~~Context + Function serializers and readers (P2) -- most complex new logic~~ **DONE**
4. ~~Token + Trait readers (P2) -- trivial (no serialization needed)~~ **DONE**
5. ~~`getFullRegistry()` + index.ts exports (P2) -- ties everything together~~ **DONE**
6. ~~`withPlasmicRegistry()` + `"./next"` subpath export (P3) -- can parallelize with step 5~~ **DONE**
7. ~~`plasmicpkgs-dev` consumer updates (P3) -- route.ts + tests + next.config.js~~ **DONE**
8. ~~`_type`/`typeTag` bug fix (P5) -- quick fix, high correctness value~~ **DONE**
9. ~~MCP server `FullRegistryResponse` parsing (P4)~~ **DONE**
10. ~~TTL cache (P4)~~ **DONE**
11. ~~Future registry data usage in MCP (P4) -- contexts, functions, tokens, traits~~ **DONE**
12. ~~P27 registry enrichment -- session.registryData, design.list-tokens devHostTokens, data.list-functions devHostFunctions, project.set/refresh devHostRegistry summary~~ **DONE**
13. ~~P28 registryData drop bug fix + defaultStyles enrichment + parentComponentName validation~~ **DONE**
14. ~~P29 slot defaultValue population from registry + registerShopify asymmetry fix~~ **DONE**

---

## Current Source Code Summary (verified 2026-02-27, updated after P1/P2/P3/P4/P5/P27/P28/P29)

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
- **plasmic-init-client.tsx**: `"use client"` registration (missing `registerShopify`)
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

### packages/plasmic-mcp/src/edit-tools.ts (P28/P29 changes)
- **`findRegistryComponent()`**: matches registry component entries by name with `$dev` suffix handling
- **`plasmicElementToTpl()`**: now accepts optional `registryComponents` parameter; applies `defaultStyles` from registry after `mkTplComponentX` creates TplComponent instances; populates slot `defaultValue` from registry for unfilled slots (recursively converts PlasmicElement trees to TplNodes and wires as `Arg` + `RenderExpr`)
- **`addChild()`**: passes `session.registryData?.components` to `plasmicElementToTpl`; validates `parentComponentName` from registry and returns non-fatal `warnings[]`
- **`AddChildResult`**: new optional `warnings?: string[]` field for parentComponentName mismatches

### packages/plasmic-mcp/src/server.ts (P28 changes)
- **`component.create-page`**, **`component.create`**, **`component.clone`**: `setSession()` calls now include `registryData: syncResult.registryData` (was missing, causing session.registryData to become undefined after these operations)
- **`node.add` handler**: surfaces `result.warnings` in JSON response (both normal and dry-run modes)

### packages/plasmic-mcp/src/session.ts
- **`Session`** now has `registryData: FullRegistryData | null` field (added in P27)
- Populated after each `syncFromDevHost()` call; cleared on `set-project` cleanup
- Consumed by `design.list-tokens` (devHostTokens), `data.list-functions` (devHostFunctions), `project.set`/`project.refresh` summary responses, and `addChild` (defaultStyles + parentComponentName validation)

### Test counts (as of P1/P2/P3/P4/P5/P27/P28/P29 completion)
- packages/plasmic-mcp-registry: 75 tests (5 suites) -- 21 existing + 54 new
- plasmicpkgs-dev: 6 tests (1 suite) -- all updated and passing
- packages/plasmic-mcp: 1697 tests (31 suites) -- all passing
  - devhost-sync.test.ts: 35 tests (was 31 -- added 4 for P27 registryData in SyncResult)
  - server.test.ts: 267 tests (was 261 -- added 6 for P28: 3 node.add warnings + 3 registryData preservation)
  - node.test.ts: added 11 tests for P28/P29 registry enrichment (defaultStyles, $dev matching, no registryData, parentComponentName mismatch/match/TplTag, slot defaultValue population, named slot defaults, explicit children override, missing slot skip, non-slot prop handling)

### Host registration global shapes (packages/host/src/register*.ts)
| Registry | Global | Entry Shape | Non-serializable |
|----------|--------|-------------|-----------------|
| Components | `__PlasmicComponentRegistry` | `{ component, meta }` | `component` (React), 6 meta fields, nested fn callbacks in props/states |
| Contexts | `__PlasmicContextRegistry` | `{ component, meta }` | `component` (React), nested fn callbacks in props, globalActions params |
| Functions | `__PlasmicFunctionsRegistry` | `{ function, meta }` | `function` (the fn), `meta.fnContext` |
| Tokens | `__PlasmicTokenRegistry` | `TokenRegistration` directly | NONE (fully serializable) |
| Traits | `__PlasmicTraitRegistry` | `{ trait, meta }` | NONE (fully serializable) |
