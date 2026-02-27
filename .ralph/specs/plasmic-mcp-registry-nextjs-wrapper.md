# @elasticpath/plasmic-mcp-registry — Full Feature Spec

## Jobs to Be Done

- As a host app developer, I want to expose a `/api/plasmic-registry` endpoint that serves all registered code component, global context, function, token, and trait metadata so that the MCP server can read variant data, props, states, and other component info without requiring Plasmic Studio's live dev host connection.
- As a host app developer, I want the API route to work in Next.js App Router without manual `serverExternalPackages` configuration so that setup is simple and maintainable.
- As a host app developer, I want the same `registerAll(PLASMIC)` registration flow to work for both `/plasmic-host` (client-side) and `/api/plasmic-registry` (server-side) so that I don't need separate registration paths.
- As an MCP server, I want to fetch serialized component metadata from the dev host's registry endpoint so that I can create Variant objects, resolve default styles, and understand component relationships when the user asks me to add or configure code components on a page.

## Background

### The Five Global Registries

Plasmic's `@plasmicapp/host` package uses five `globalThis` arrays populated at import time by registration functions:

| Registry | Entry Shape | Populated By |
|----------|-------------|--------------|
| `__PlasmicComponentRegistry` | `{ component: React.ComponentType, meta: CodeComponentMeta }` | `registerComponent()` |
| `__PlasmicContextRegistry` | `{ component: React.ComponentType, meta: GlobalContextMeta }` | `registerGlobalContext()` |
| `__PlasmicFunctionsRegistry` | `{ function: Function, meta: CustomFunctionMeta }` | `registerFunction()` |
| `__PlasmicTokenRegistry` | `{ name, value, type, displayName?, selector? }` (flat — no `meta` wrapper) | `registerToken()` |
| `__PlasmicTraitRegistry` | `{ trait: string, meta: TraitMeta }` | `registerTrait()` |

Each registration function lives in a separate subpath export (e.g., `@plasmicapp/host/registerComponent`) whose compiled output has **zero React runtime dependencies** — pure `globalThis` operations. The RSC errors come from the *component packages* (e.g., `@plasmicpkgs/commerce`, `@elasticpath/plasmic-ep-commerce-elastic-path`) which import React components with hooks.

### The RSC Boundary Problem

Next.js App Router statically analyses imports at compile time. Server-side API routes that import registration modules (which in turn import React components with hooks like `useRef`, `createContext`) trigger RSC boundary errors — even though those hooks are never called. The API route only reads the `meta` field from each registry entry.

`serverExternalPackages` in `next.config.js` tells Next.js to skip RSC bundler analysis for specified packages, loading them via Node.js `require()` at runtime. The hooks exist in memory but are never executed.

### What the MCP Server Needs

The MCP server resolves components from the **persisted site model** (`site.components`), not from `__PlasmicComponentRegistry`. However, when working with code components, the MCP server needs metadata that only exists in the host registration:

- **Variants** — `{ cssSelector, displayName }` to create variant objects for style targeting
- **Props** — type descriptors, options, default values to understand what can be configured
- **States** — type, variableType, valueProp, onChangeProp for state management
- **Default styles** — CSS applied when a component is first inserted
- **Parent/child relationships** — `parentComponentName` for hierarchy validation
- **Global contexts** — provider configuration and `globalActions`
- **Functions** — custom function signatures for data binding
- **Tokens** — design tokens (colors, spacing, fonts) registered by packages
- **Traits** — custom trait definitions

Non-serializable fields (React component functions, callback functions, React elements in `actions`/`templates`) are **not needed** by the MCP server. They are Studio UI or canvas runtime features.

### Dev Name Handling

The consumer's host app (e.g., `plasmicpkgs-dev`) may use a `registerWithDevMeta` wrapper that adds `$dev` suffixes to component names to avoid conflicts with production hostless names. This is entirely the consumer's responsibility — the registry package reads whatever names are in the global registries at request time. If components are registered with `$dev` suffixes, the registry endpoint serves them with `$dev` suffixes.

## Acceptance Criteria

### Package Rename
- [ ] Directory renamed from `packages/plasmic-registry/` to `packages/plasmic-mcp-registry/`
- [ ] npm package name changed to `@elasticpath/plasmic-mcp-registry`
- [ ] All imports in `plasmicpkgs-dev/` updated to use new package name
- [ ] Existing functionality (getComponentRegistry, serializeComponentMeta) unchanged

### All Five Registries
- [ ] `getComponentRegistry()` — reads `__PlasmicComponentRegistry`, strips non-serializable fields (existing)
- [ ] `getContextRegistry()` — reads `__PlasmicContextRegistry`, strips `component` ref and non-serializable fields, returns serialized `GlobalContextMeta` array
- [ ] `getFunctionRegistry()` — reads `__PlasmicFunctionsRegistry`, strips `function` ref and non-serializable fields (`fnContext`), returns serialized `CustomFunctionMeta` array
- [ ] `getTokenRegistry()` — reads `__PlasmicTokenRegistry`, returns `TokenRegistration[]` as-is (already fully serializable — flat shape with name, value, type, displayName, selector)
- [ ] `getTraitRegistry()` — reads `__PlasmicTraitRegistry`, returns `TraitRegistration[]` as-is (already fully serializable — trait string + meta with label, type, options)
- [ ] `getFullRegistry()` — convenience function returning `{ components, contexts, functions, tokens, traits }` in one call

### Serialization
- [ ] Component metas: strip `component` ref, `figmaPropsTransform`, `treeLabel`, `componentHelpers`, `refActions`, `actions`, `templates`, and any nested functions (existing)
- [ ] Context metas: strip `component` ref, nested functions in props, `globalActions` functions
- [ ] Function metas: strip `function` ref, `fnContext` (contains function)
- [ ] Token registrations: no stripping needed (fully serializable)
- [ ] Trait registrations: no stripping needed (fully serializable)
- [ ] All serialization uses JSON roundtrip to strip nested functions, Symbols, and undefined values

### Types
- [ ] `SerializedComponentMeta` — existing, covers all JSON-safe CodeComponentMeta fields
- [ ] `SerializedContextMeta` — mirrors GlobalContextMeta minus component ref and functions
- [ ] `SerializedFunctionMeta` — mirrors CustomFunctionMeta minus function ref and fnContext
- [ ] `TokenRegistration` — re-exported from types (already serializable)
- [ ] `TraitRegistration` — re-exported from types (already serializable)
- [ ] `FullRegistryResponse` — `{ components, contexts, functions, tokens, traits }`

### Next.js Config Wrapper
- [ ] `withPlasmicRegistry()` function exported from `@elasticpath/plasmic-mcp-registry/next` subpath
- [ ] Auto-detects `@plasmicpkgs/*` dependencies from consumer's `package.json`
- [ ] Auto-detects `@elasticpath/plasmic-*` dependencies from consumer's `package.json`
- [ ] Auto-detects `@plasmicapp/host` dependency
- [ ] Adds detected packages to `serverExternalPackages` in the returned config
- [ ] Merges with any existing `serverExternalPackages` entries (no duplicates)
- [ ] Handles missing `serverExternalPackages` key gracefully
- [ ] Logs `console.warn` if `package.json` cannot be read, proceeds without auto-detected packages
- [ ] Has zero Next.js npm dependency — uses only Node.js built-ins (`fs`, `path`)
- [ ] Does not modify any other config keys

### Package Exports
- [ ] `"."` export: `dist/index.js` + `dist/index.d.ts` (core API — all registry readers + types)
- [ ] `"./next"` export: `dist/next.js` + `dist/next.d.ts` (Next.js config wrapper)
- [ ] Both subpaths resolve correctly after `yarn build`

### Tests
- [ ] Existing serialize and read-registry tests continue to pass
- [ ] Unit tests for `getContextRegistry()` — reads from global, strips component ref and functions
- [ ] Unit tests for `getFunctionRegistry()` — reads from global, strips function ref and fnContext
- [ ] Unit tests for `getTokenRegistry()` — reads from global, preserves all fields
- [ ] Unit tests for `getTraitRegistry()` — reads from global, preserves all fields
- [ ] Unit tests for `getFullRegistry()` — returns all five registries in one response
- [ ] Unit tests for `withPlasmicRegistry()` covering:
  - Auto-detection of `@plasmicpkgs/*` packages
  - Auto-detection of `@elasticpath/plasmic-*` packages
  - Auto-detection of `@plasmicapp/host`
  - Merge with existing `serverExternalPackages`
  - Deduplication of entries
  - Console warning on `package.json` read failure
  - Pass-through of all other config keys
  - Empty config `{}` input
  - No Plasmic packages found

### Consumer Integration (plasmicpkgs-dev)
- [ ] `plasmicpkgs-dev/next.config.js` uses `withPlasmicRegistry()` wrapper
- [ ] `plasmicpkgs-dev/app/api/plasmic-registry/route.ts` imports from `@elasticpath/plasmic-mcp-registry`
- [ ] API route calls `getFullRegistry()` and returns `{ components, contexts, functions, tokens, traits }`
- [ ] Response includes `variants` field for components that register them (e.g., EPBundleOptionTrigger)
- [ ] `yarn dev` in `plasmicpkgs-dev` starts without RSC errors
- [ ] `curl localhost:3001/api/plasmic-registry` returns full registry JSON

### MCP Server Sync (packages/plasmic-mcp)
- [ ] `fetchDevHostRegistry()` fetches from `{hostUrl}/api/plasmic-registry`
- [ ] Parses the `FullRegistryResponse` shape (components, contexts, functions, tokens, traits)
- [ ] On component list: enriches site model components with variant metadata from registry (cssSelector, displayName)
- [ ] On component add: uses `defaultStyles` and `defaultValue` slot data from registry meta
- [ ] Registry data cached in memory with configurable TTL (avoid re-fetching on every MCP call)
- [ ] Cache invalidated on explicit refresh or TTL expiry
- [ ] Graceful degradation: if dev host is unreachable, MCP continues working with site model data only (no variant enrichment)
- [ ] Dev host URL sourced from MCP server configuration (environment variable or project settings)

## Happy Path

1. Developer installs `@elasticpath/plasmic-mcp-registry` and wraps their `next.config.js` with `withPlasmicRegistry()`
2. Developer creates `app/api/plasmic-registry/route.ts` that imports their registration module and calls `getFullRegistry()`
3. On `yarn dev`, the Next.js dev server starts without RSC errors
4. `GET /api/plasmic-registry` returns all registered metadata as JSON: `{ components: [...], contexts: [...], functions: [...], tokens: [...], traits: [...] }`
5. MCP server is configured with the dev host URL (e.g., `http://localhost:3001`)
6. When the user asks MCP to add a code component, MCP fetches the registry, looks up the component's metadata, and uses it to:
   - Create variant objects (from `variants` field)
   - Apply default styles (from `defaultStyles`)
   - Populate default slot content (from `props.children.defaultValue`)
   - Validate parent/child relationships (from `parentComponentName`)
7. MCP caches the registry response — subsequent operations reuse the cache until TTL expires

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Consumer has no `@plasmicpkgs/*` deps | `serverExternalPackages` contains only `@elasticpath/plasmic-*` and `@plasmicapp/host` if present |
| Consumer already has manual `serverExternalPackages` | Merged with auto-detected packages, no duplicates |
| `package.json` can't be read (permissions, monorepo root) | `console.warn` logged, config returned without auto-detected packages |
| Consumer passes empty config `{}` | `serverExternalPackages` added with auto-detected packages |
| No Plasmic packages installed at all | Empty `serverExternalPackages` array, no error |
| Consumer uses Express/Fastify instead of Next.js | No wrapper needed — import registration module and call `getFullRegistry()` directly |
| Dev host unreachable when MCP server fetches | MCP logs warning, continues without registry enrichment |
| Dev host returns malformed JSON | MCP logs error, returns null, falls back to site model only |
| Registry has components with `$dev` suffix names | MCP uses the names as-is; dev name handling is the consumer's concern |
| Registry has no contexts/functions/tokens/traits | Corresponding arrays are empty `[]` in the response |
| `__PlasmicTokenRegistry` or `__PlasmicTraitRegistry` is null/undefined | Reader returns empty array |
| Component meta has circular reference (unlikely but defensive) | JSON.stringify catch returns minimal `{ name: "" }` fallback |
| Multiple calls to MCP within cache TTL | Cached registry response reused, no redundant HTTP fetch |

## Out of Scope

- Upstream `@plasmicpkgs/*` package modifications — we don't modify third-party packages
- Meta extraction into separate `.meta.ts` files — not needed because `serverExternalPackages` handles the RSC boundary; meta co-location with components is fine
- The `registerWithDevMeta` dev name wrapper itself — that's consumer implementation in `plasmicpkgs-dev`, not the registry package's concern
- MCP server creating new code components in the Plasmic site model — MCP only *uses* existing registered components
- Support for `__PlasmicContextRegistry` global actions as invocable MCP tools — future iteration
- Real-time push-based sync (WebSocket/SSE) from dev host to MCP — HTTP polling with cache TTL is sufficient
