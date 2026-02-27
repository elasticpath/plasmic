# MCP Dev Host Variant Sync

## Jobs to Be Done

- As an MCP user, I want code component variants (e.g., "Selected" on EPBundleOptionTrigger) to be automatically available for styling via `node.update-styles` and `variant.list` — without manual Studio UI interaction — so that I can style selected/hovered/pressed states of code components entirely through the MCP
- As an MCP user, I want the MCP to automatically discover my dev host URL and sync variant metadata on `project.set`, mirroring how Plasmic Studio connects to the dev host, so there is zero extra configuration
- As a dev host app author, I want an easy-to-configure API route that exposes my component registrations — following the same pattern as `<PlasmicCanvasHost />` but for programmatic access

## Background

### The Data Gap

The Plasmic MCP server reads project data from the **persisted project bundle** (REST API). Code component variant data requires **two pieces** that are only available at runtime:

1. **Variant metadata** (`codeComponentMeta.variants`) — synced by Studio's `syncCodeComponentsVariants()` from the dev host's `globalThis.__PlasmicComponentRegistry`
2. **Variant objects** (`component.variants[]` entries with `codeComponentName` + `codeComponentVariantKeys`) — created manually by clicking "+" in Studio's component arena

Neither exists in the persisted bundle until Studio has: (a) connected to the dev host, (b) the user has manually created variant frames, and (c) the project has been saved. The MCP has no browser, no iframe, and no connection to the dev host.

### How Studio Gets the Data

1. Studio loads the dev host URL in an iframe (`/plasmic-host` page)
2. The page runs `registerComponent()` calls which push `{ component, meta }` to `globalThis.__PlasmicComponentRegistry`
3. Studio reads this global via `codeComponentsRegistry.getRegisteredComponentsAndContextsMap()`
4. `syncCodeComponentsVariants()` copies `meta.variants` to `codeComponentMeta.variants` on each code component
5. User manually creates Variant objects via `TplMgr.createCodeComponentVariant()`

### Ownership Constraint

We do **not** control the `@plasmicapp/host` package or its release cycle. We cannot add exports to it. Instead, we create an `@elasticpath/plasmic-registry` package that reads from the same `globalThis.__PlasmicComponentRegistry` global that `@plasmicapp/host`'s `registerComponent()` writes to. This is safe because the global is a stable public contract — it's the interface between host apps and Plasmic Studio.

### Context Token Budget

A typical dev host registers **80–150+ components** across multiple packages. Each full `CodeComponentMeta` is 2–4 KB (props schemas, slot defaults, descriptions). A full registry dump would be **250–375 KB**.

The API must serve the **full serializable metadata** so future features can consume any field. However, consumers (like the MCP) must be disciplined about what they extract and retain in memory/context:

| Layer | What it holds | Token impact |
|-------|--------------|--------------|
| API response (wire) | Full serializable meta for all components | ~250–375 KB (transient, discarded after processing) |
| MCP sync processing | Extracts `name` + `variants` from the response, discards the rest | ~1–3 KB retained (only variant-bearing components) |
| Session state | Boolean flag + list of synced component names | ~200 bytes |
| Site model | `codeComponentMeta.variants` + `Variant` objects applied to existing nodes | Zero extra — part of existing model |

### CodeComponentMeta Serialization

`CodeComponentMeta<P>` from `@plasmicapp/host` has both serializable and non-serializable fields:

**JSON-serializable** (included in API response):
`name`, `displayName`, `description`, `section`, `thumbnailUrl`, `importName`, `importPath`, `isDefaultExport`, `classNameProp`, `refProp`, `defaultStyles`, `parentComponentName`, `isAttachment`, `providesData`, `alwaysAutoName`, `hideFromContentCreators`, `defaultDisplay`, `trapsFocus`, `isRepeatable`, `styleSections`, `variants`, `figmaMappings`, `props` (type descriptors only — string enums, choice arrays, default scalar values), `states` (type + access descriptors)

**Not JSON-serializable** (excluded from API response):
`figmaPropsTransform` (function), `treeLabel` (may contain functions), `componentHelpers` (contains `initFunc`, `onChangeArgsToValue`), `refActions` (contains functions), `actions` (may contain functions), `templates` (may contain React elements/functions)

The `props` field requires special handling: `PropType` definitions can contain functions (e.g., `hidden` callbacks, `validator` functions). These are stripped during serialization; only the declarative parts (type, displayName, options, defaultValue scalar) are retained.

## Solution Architecture

### Part 1: `@elasticpath/plasmic-registry` Package (new)

A small npm package that reads from `@plasmicapp/host`'s global registry and serializes the component metadata for HTTP transport:

```
packages/plasmic-registry/
  src/
    index.ts                 — main exports
    read-registry.ts         — reads globalThis.__PlasmicComponentRegistry
    serialize.ts             — strips non-serializable fields from ComponentMeta
    types.ts                 — SerializedComponentMeta, RegistryResponse types
  __tests__/
    read-registry.test.ts    — unit tests for registry reading
    serialize.test.ts        — unit tests for serialization (function stripping, edge cases)
  package.json               — @elasticpath/plasmic-registry, zero runtime deps
  tsconfig.json
  vitest.config.ts
  README.md                  — usage instructions
```

**Core functions:**

```typescript
// read-registry.ts

/**
 * Reads globalThis.__PlasmicComponentRegistry and returns the full
 * serializable metadata for all registered components.
 *
 * Non-serializable fields (functions, React elements) are stripped.
 * Everything else is preserved so consumers can use any field.
 */
export function getComponentRegistry(): SerializedComponentMeta[] { ... }
```

```typescript
// serialize.ts

/**
 * Strips non-serializable fields from a ComponentMeta.
 * Preserves all JSON-safe fields including props type descriptors,
 * states, variants, display metadata, etc.
 */
export function serializeComponentMeta(meta: any): SerializedComponentMeta { ... }
```

**Key design decisions:**
- Reads from the same `globalThis.__PlasmicComponentRegistry` global that `@plasmicapp/host` writes to
- Returns **full serializable metadata** — not just name + variants
- Strips functions and React elements (they can't cross HTTP)
- Zero runtime dependency on `@plasmicapp/host` — reads from `globalThis`
- Consumers extract what they need from the full response

### Part 2: Host App API Route

Any host app exposes the registry with two files:

**Server-compatible registration file** (needed because `plasmic-init-client.tsx` is `"use client"`):
```typescript
// plasmicpkgs-dev/plasmic-init-server.ts
// Server-compatible version — no "use client" directive.
// Calls the same registration functions so globalThis.__PlasmicComponentRegistry
// is populated when imported by API routes.
import { PLASMIC } from "@/plasmic-init";
import { registerWithDevMeta } from "@/plasmic-register-dev-meta";
// ... same registration calls as plasmic-init-client.tsx ...
```

**API route** (one-liner):
```typescript
// plasmicpkgs-dev/app/api/plasmic-registry/route.ts
import "../../plasmic-init-server";
import { getComponentRegistry } from "@elasticpath/plasmic-registry";

export function GET() {
  return Response.json({ components: getComponentRegistry() });
}
```

### Part 3: MCP Sync on `project.set`

New module `devhost-sync.ts` in `packages/plasmic-mcp/src/`:

1. **Resolves dev host URL** from `project.hostUrl` (already in the API response)
2. **Fetches** `{hostUrl}/api/plasmic-registry` with a 5-second timeout
3. **Extracts variant data only** — iterates the response, collects components with non-empty `variants`, discards the rest immediately (the full props/states/descriptions are not retained)
4. **Syncs variant metadata** to the site model — mirroring `syncCodeComponentsVariants()`
5. **Creates missing Variant objects** on wrapper components — mirroring `createCodeComponentVariant()`
6. **Records minimal sync state** — `{ synced: true, components: ["name1", "name2"] }`

### Part 4: Variant Resolution Integration (existing code, now with data)

The existing MCP code from commit `5dc793250` already handles:
- `variant.list` returning `codeComponentVariants[]`
- `resolveVariant()` matching by key, displayName, or UUID
- `create-style` accepting registered CC selectors

These work correctly when data is present. After the sync populates the data, they work as designed.

## Acceptance Criteria

### `@elasticpath/plasmic-registry` Package
- [ ] `getComponentRegistry()` reads from `globalThis.__PlasmicComponentRegistry`
- [ ] Returns `SerializedComponentMeta[]` with all JSON-serializable fields from `CodeComponentMeta`
- [ ] Strips non-serializable fields: functions (`figmaPropsTransform`, `treeLabel`, `componentHelpers`, `refActions`, `actions`), React elements (`templates`)
- [ ] Strips functions nested inside `props` definitions (e.g., `hidden` callbacks, `validator` functions) while preserving declarative prop type descriptors
- [ ] Works in Node.js (server-side API routes) — no `window` dependency
- [ ] Works in browser
- [ ] Returns empty array when no registrations exist
- [ ] `SerializedComponentMeta` and `RegistryResponse` types exported
- [ ] Package has zero runtime dependencies
- [ ] `README.md` with setup instructions (paralleling `PlasmicCanvasHost` pattern)

### `@elasticpath/plasmic-registry` Tests
- [ ] Unit test: `getComponentRegistry()` reads from global, returns correct shape
- [ ] Unit test: `serializeComponentMeta()` strips functions, preserves serializable fields
- [ ] Unit test: `serializeComponentMeta()` handles `props` with nested function fields (hidden, validator)
- [ ] Unit test: empty registry returns empty array
- [ ] Unit test: registration with `variants` field preserved correctly
- [ ] Unit test: registration without `variants` field — `variants` is `undefined` in output
- [ ] Unit test: duplicate component names handled (all entries returned, consumer de-duplicates)
- [ ] Unit test: malformed meta (missing required fields) handled gracefully

### Dev Host API Route
- [ ] `plasmicpkgs-dev/app/api/plasmic-registry/route.ts` exists
- [ ] `plasmicpkgs-dev/plasmic-init-server.ts` exists — server-compatible registration (no `"use client"`)
- [ ] `GET /api/plasmic-registry` returns JSON with full serialized component metadata
- [ ] The route handles errors gracefully (registration failure returns 500 with message)

### Dev Host API Route Tests
- [ ] Integration test: route returns expected response shape
- [ ] Integration test: response includes EP bundle components with variants
- [ ] Integration test: response does not contain function fields

### MCP Sync
- [ ] On `project.set`, if the project has a `hostUrl`, the MCP fetches `{hostUrl}/api/plasmic-registry`
- [ ] Response is parsed; only variant-bearing components are extracted and retained
- [ ] Full response payload is not stored in session/context
- [ ] `codeComponentMeta.variants` is populated for each matching code component in the site model
- [ ] Missing `Variant` objects are created on wrapper components (components whose `tplTree` root is a `TplComponent` referencing the code component)
- [ ] Created `Variant` objects have correct `codeComponentName` and `codeComponentVariantKeys` fields
- [ ] Component name matching handles the `$dev` suffix flexibly
- [ ] After sync, `variant.list` on the wrapper component returns the code component variants
- [ ] After sync, `node.update-styles` with `variant="selected"` resolves successfully
- [ ] Sync failure (dev host not running, network error, timeout) is non-fatal — logs a warning, project still loads
- [ ] Sync uses a 5-second HTTP timeout
- [ ] Session sync state is minimal: `{ devHostSynced: boolean, syncedVariantComponents: string[] }`

### MCP Sync Tests
- [ ] Unit test: `fetchDevHostRegistry()` — successful fetch returns parsed components
- [ ] Unit test: `fetchDevHostRegistry()` — network error returns null, logs warning
- [ ] Unit test: `fetchDevHostRegistry()` — timeout returns null, logs warning
- [ ] Unit test: `fetchDevHostRegistry()` — 404 returns null, logs warning
- [ ] Unit test: `fetchDevHostRegistry()` — malformed JSON returns null, logs warning
- [ ] Unit test: `syncVariantMetadata()` — populates `codeComponentMeta.variants` on matching code components
- [ ] Unit test: `syncVariantMetadata()` — skips components not in the site model
- [ ] Unit test: `syncVariantMetadata()` — handles `$dev` suffix matching
- [ ] Unit test: `syncVariantMetadata()` — overwrites existing variant metadata (dev host is source of truth)
- [ ] Unit test: `ensureVariantObjects()` — creates Variant objects on wrapper components
- [ ] Unit test: `ensureVariantObjects()` — does not duplicate existing variants
- [ ] Unit test: `ensureVariantObjects()` — creates variants on multiple wrappers referencing same code component
- [ ] Unit test: `ensureVariantObjects()` — created Variant has correct shape (`name: ""`, `codeComponentName`, `codeComponentVariantKeys`)
- [ ] Unit test: full sync flow — fetch → filter → sync metadata → create variants
- [ ] Unit test: `hostUrl` is null — sync skipped entirely, no fetch
- [ ] Integration test: sync against real WAB model classes — variant objects are valid Variant instances
- [ ] Integration test: after sync, `listVariants()` returns code component variants
- [ ] Integration test: after sync, `resolveVariant()` finds variant by key and displayName

### Variant Object Creation
- [ ] Mirrors `TplMgr.createCodeComponentVariant()` behavior: creates `Variant` with `name: ""`, `codeComponentName`, `codeComponentVariantKeys: [key]`
- [ ] Does not duplicate existing variants (checks before creating)
- [ ] For each variant key in the metadata, exactly one `Variant` object exists after sync

### Persistence
- [ ] Synced data is **in-memory only** — not persisted to Plasmic API unless user calls `project.save`
- [ ] If the user calls `project.save` after sync, the variant metadata and objects are included in the save
- [ ] On `project.refresh`, the sync runs again (re-fetches from dev host)

### MCP README.md Documentation
- [ ] New "Dev Host Sync" section in `packages/plasmic-mcp/README.md`
- [ ] Explains what dev host sync does and why it's needed
- [ ] Documents the `project.hostUrl` prerequisite
- [ ] Documents the `/api/plasmic-registry` endpoint requirement on the dev host
- [ ] Shows how to set up the API route using `@elasticpath/plasmic-registry`
- [ ] Documents the sync behavior: automatic on `project.set`, re-syncs on `project.refresh`
- [ ] Documents failure behavior: non-fatal, logs warning
- [ ] Shows example `variant.list` output after sync with code component variants
- [ ] Shows example `node.update-styles` with `variant="selected"`
- [ ] Documents how to verify sync worked (call `variant.list`, check for `codeComponentVariants`)

## Happy Path

1. User has dev host running at `http://localhost:3388` with EP bundle components registered
2. Plasmic project has `hostUrl: "http://localhost:3388"` set in project settings
3. User calls `project.set` with the project ID
4. MCP loads the project bundle from the Plasmic API
5. MCP reads `project.hostUrl` → `http://localhost:3388`
6. MCP fetches `http://localhost:3388/api/plasmic-registry`
7. Response: full serializable metadata for all ~150 registered components (~300 KB)
8. MCP iterates the response, extracts only variant-bearing components (~3–5 entries with `variants`)
9. Discards the rest of the response (not stored in session or context)
10. For each variant-bearing component, finds the matching code component in the site model
11. Sets `codeComponentMeta.variants` on each (mirroring `syncCodeComponentsVariants()`)
12. Finds wrapper components whose `tplTree.component` references those code components
13. Creates `Variant` objects for each variant key (mirroring `createCodeComponentVariant()`)
14. Records sync state: `{ devHostSynced: true, syncedVariantComponents: ["...$dev", "...$dev", "...$dev"] }`
15. User calls `variant.list` on "Bundle Option Card" → sees `codeComponentVariants: [{ key: "selected", displayName: "Selected", ... }]`
16. User calls `node.update-styles` with `variant="selected"` → styles applied successfully

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Dev host not running | Fetch fails with timeout/connection error. Warning logged. Project loads normally without CC variant data. |
| `project.hostUrl` is null/empty | Skip dev host sync entirely. No warning (normal for projects without a dev host). |
| Dev host running but `/api/plasmic-registry` route doesn't exist (404) | Warning logged. Project loads normally. |
| Registry returns components not in the project | Ignored — only components in the site model are synced. |
| Component name has `$dev` suffix in project but not in registry (or vice versa) | Flexible matching: try exact, then try with/without `$dev`. |
| Component already has `codeComponentMeta.variants` populated (from Studio sync+save) | Overwritten with fresh dev host data (dev host is source of truth). |
| Variant object already exists for a key | Not duplicated — existing variant preserved. |
| Component registration has no `variants` field | Not synced — filtered out during processing. |
| Multiple wrapper components reference the same code component | Variant objects created on all wrapper components. |
| `project.refresh` called | Sync runs again, re-fetches from dev host. |
| Dev host URL has trailing slash | Handled (normalize URL). |
| Dev host returns malformed JSON | Warning logged. Project loads normally. |
| Very large response (many components, large props) | Processed streaming-style: iterate, extract variants, discard. No full-response retention. |
| `registerComponent()` called multiple times with same component | All entries in API response; MCP matches by name (last-wins for duplicate names). |
| Host app uses `registerWithDevMeta` (`$dev` names) | Registry returns `$dev` names — matches persisted `$dev` names directly. |
| Host app does NOT use `registerWithDevMeta` | Registry returns base names — matches base names directly. |
| Props contain function fields (hidden callbacks, validators) | Stripped by `serializeComponentMeta()` — only declarative descriptors in response. |
| Meta contains React elements (templates, default slot values) | Stripped by `serializeComponentMeta()`. |

## Out of Scope

- **Modifying `@plasmicapp/host`** — we don't control that package; we read from its global
- **Headless browser / iframe approach** — we use a server-side API route
- **WebSocket live sync** — one-shot on `project.set` / `project.refresh`
- **Auto-detecting dev host URL** — comes from `project.hostUrl` in Plasmic project settings
- **Creating arena frames** — Studio's `createCodeComponentVariant()` also creates arena frames; the MCP does not need them
- **Modifying the Plasmic platform API** — no changes to Plasmic's REST API or server
- **Production/hostless component sync** — hostless packages already have variants persisted during publishing

## Platform Reference Files

| File | Purpose |
|------|---------|
| `packages/host/src/registerComponent.ts:393-407` | `registerComponent()` — writes to `globalThis.__PlasmicComponentRegistry` |
| `packages/host/src/registerComponent.ts:173-354` | `CodeComponentMeta` type — full interface definition |
| `packages/host/src/canvas-host.tsx` | `PlasmicCanvasHost` — the existing pattern we're paralleling |
| `platform/wab/src/wab/shared/code-components/code-components.ts:1291-1323` | `syncCodeComponentsVariants()` — Studio's sync logic to mirror |
| `platform/wab/src/wab/shared/code-components/code-components.ts:4054-4072` | `mkCodeComponentVariantsFromMeta()` — creates CodeComponentVariantMeta instances |
| `platform/wab/src/wab/shared/TplMgr.ts:669-686` | `createCodeComponentVariant()` — creates Variant objects |
| `platform/wab/src/wab/client/utils/app-hosting-utils.ts:5-40` | `getHostUrl()` — Studio's hostUrl resolution chain |
| `platform/wab/src/wab/shared/ApiSchema.ts:488` | `ApiProject.hostUrl` — project hostUrl in API response |
| `packages/plasmic-mcp/src/edit-tools.ts:1127-1141` | `getCodeComponentVariantMetas()` — MCP's existing reader |
| `packages/plasmic-mcp/src/edit-tools.ts:1189-1293` | `resolveVariant()` — MCP's existing resolver |
| `packages/plasmic-mcp/src/model-loader.ts` | Project bundle loading — where sync is added |
| `plasmicpkgs-dev/plasmic-init-client.tsx` | Dev host component registration (`"use client"`) |
| `plasmicpkgs-dev/plasmic-register-dev-meta.ts` | Dev naming wrapper (`$dev` suffix logic) |

## Files to Create/Modify

### `@elasticpath/plasmic-registry` (new package)
| File | Purpose |
|------|---------|
| `packages/plasmic-registry/package.json` | Package manifest, zero runtime deps |
| `packages/plasmic-registry/tsconfig.json` | TypeScript config |
| `packages/plasmic-registry/vitest.config.ts` | Test config |
| `packages/plasmic-registry/README.md` | Setup instructions (PlasmicCanvasHost parallel pattern) |
| `packages/plasmic-registry/src/index.ts` | Main exports |
| `packages/plasmic-registry/src/read-registry.ts` | `getComponentRegistry()` — reads `globalThis.__PlasmicComponentRegistry` |
| `packages/plasmic-registry/src/serialize.ts` | `serializeComponentMeta()` — strips non-serializable fields |
| `packages/plasmic-registry/src/types.ts` | `SerializedComponentMeta`, `RegistryResponse` |
| `packages/plasmic-registry/src/__tests__/read-registry.test.ts` | Unit tests for registry reading |
| `packages/plasmic-registry/src/__tests__/serialize.test.ts` | Unit tests for serialization |

### Dev host app (consumer)
| File | Purpose |
|------|---------|
| `plasmicpkgs-dev/plasmic-init-server.ts` (new) | Server-compatible registration (no `"use client"`) |
| `plasmicpkgs-dev/app/api/plasmic-registry/route.ts` (new) | Next.js App Router API route |

### MCP server (consumer)
| File | Purpose |
|------|---------|
| `packages/plasmic-mcp/src/devhost-sync.ts` (new) | `fetchDevHostRegistry()`, `syncVariantMetadata()`, `ensureVariantObjects()` |
| `packages/plasmic-mcp/src/model-loader.ts` (modify) | Add `syncFromDevHost()` call after bundle loading |
| `packages/plasmic-mcp/src/session.ts` (modify) | Add `devHostSynced`, `syncedVariantComponents` to session state |
| `packages/plasmic-mcp/src/__tests__/devhost-sync.test.ts` (new) | Unit tests for fetch, sync metadata, ensure variants |
| `packages/plasmic-mcp/src/__tests__/devhost-sync.integration.test.ts` (new) | Integration tests against real WAB model classes |
| `packages/plasmic-mcp/README.md` (modify) | New "Dev Host Sync" section |
