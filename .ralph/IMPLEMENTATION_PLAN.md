# Implementation Plan

_Last updated: 2026-03-05 (P0.0 completed)_

## Status Legend
- `[ ]` Not started
- Priority: **P0** Critical | **P1** High | **P2** Medium | **P3** Low
- Complexity: **S** Small (< 1 day) | **M** Medium (1-2 days) | **L** Large (3-5 days) | **XL** Extra Large (5+ days)

---

## P0 -- WebSocket Live Sync (Core)

The MCP server is currently HTTP-only. When another user saves in Studio, the MCP has no way to know until its next save attempt fails with a 412 conflict. WebSocket live sync resolves this by receiving real-time `update` events and rebasing the in-memory model, exactly as Studio does.

### P0.0 -- Prerequisites: Type Declarations, Mocks, and Shared Code Imports ✅ COMPLETED

All type declarations, mocks, vitest aliases, and accessor methods implemented. Typecheck clean, all 1668 unit tests pass.

**What was done:**
- Extended `FastBundler` in both `.d.ts` files with `unbundlePartial`, `allUuids`, `objByAddr`
- Added `IChangeRecorder` interface to observable-model declarations (both files)
- Added `getRecorder()` accessor to `ChangeTracker`
- Added `getStack()`/`replaceStack()` accessors and exported `UndoOperation` from `undo-manager.ts`
- Added 7 new module declarations: `server-updates-utils`, `asyncutil`, `socket`, `ApiSchema`, `Arenas`, `collections`, `common`
- Created 7 new mock files with proper implementations
- Added 7 new vitest aliases in `vitest.config.unit.ts`

**Files modified:** `wab.d.ts`, `wab-externals.d.ts`, `src/__mocks__/wab-bundler.ts`, `src/__mocks__/wab-observable-model.ts`, `src/change-tracker.ts`, `src/undo-manager.ts`, `vitest.config.unit.ts`
**Files created:** `src/__mocks__/wab-server-updates-utils.ts`, `src/__mocks__/wab-asyncutil.ts`, `src/__mocks__/wab-socket-types.ts`, `src/__mocks__/wab-api-schema.ts`, `src/__mocks__/wab-arenas.ts`, `src/__mocks__/wab-collections.ts`, `src/__mocks__/wab-common-ext.ts`

### P0.1 -- Socket.io Client Module

- [ ] **Create `src/socket-client.ts`** -- a socket.io-client wrapper that manages connection lifecycle, authentication, and event routing. Exposes `connect(host, auth, projectId)`, `disconnect()`, and event callbacks. Uses the same auth headers (`x-plasmic-api-user`, `x-plasmic-api-token`) already in `api-client.ts`. Connects to `{apiHost}/api/v1/socket` with `transports: ["websocket"]`. **Imports `ClientToServerEvents` and `ServerToClientEvents` from `@/wab/shared/api/socket`** for type-safe event handling — same types Studio uses.
  - Files: create `packages/plasmic-mcp/src/socket-client.ts`; modify `packages/plasmic-mcp/package.json` (add `socket.io-client` dependency)
  - Dependencies: P0.0 (needs socket type declarations)
  - Complexity: **M**
  - Key design decisions:
    - The server-side socket at `/api/v1/socket` (in `platform/wab/src/wab/server/routes/projects-socket.ts`) authenticates via `x-plasmic-api-user` + `x-plasmic-api-token` headers in `extraHeaders` (extracted by `extractAuthUser()` at lines 314-361)
    - Must also include `Authorization: Basic ...` header when `basicAuthUser`/`basicAuthPassword` are configured (matches `api-client.ts` lines 67-72)
    - Must emit `subscribe` with `{ namespace: "projects", projectIds: [projectId], studio: true }` on connect (the `studio: true` flag at line 193 enables view events and presence tracking)
    - Handle `initServerInfo` event with `{ modelSchemaHash, bundleVersion, selfPlayerId }` -- compare against session's known schema hash and bundle version
    - Auto-reconnect is built into socket.io-client default behavior; on reconnect, re-subscribe and re-emit current view state
    - `socket.io-client` will be externalized by esbuild (Layer 5 externalizes bare imports), so it must be in `dependencies`, not `devDependencies`
    - **Reference:** `packages/watcher/src/watcher.ts` has a simpler socket.io client (`PlasmicRemoteChangeWatcher`) that connects to the same `/api/v1/socket` path. It uses project-token auth and doesn't support `studio: true`, `view` events, or `initServerInfo` data -- too limited to reuse directly, but useful as a socket.io connection pattern reference. The CLI uses `socket.io-client@^4.1.2`; MCP should use a compatible version.

### P0.2 -- Update Queue and Serialization

- [ ] **Create `src/update-queue.ts`** -- wraps Studio's `PushPullQueue` from `@/wab/commons/asyncutil` (same queue class Studio uses for `modelChangeQueue`) with gating logic for saves and mutations. **Not a from-scratch queue implementation** — imports `PushPullQueue` and `drainQueue` directly. Adds: save-in-flight gating, self-update filtering, branch filtering.
  - Files: create `packages/plasmic-mcp/src/update-queue.ts`
  - Dependencies: P0.0 (needs asyncutil declarations)
  - Complexity: **S**
  - Key design decisions:
    - **Import `PushPullQueue` and `drainQueue`** from `@/wab/commons/asyncutil` — same queue primitives Studio uses in `StudioCtx.modelChangeQueue` (StudioCtx.tsx lines 4196-4199)
    - Must gate processing when a save is in-flight (save-manager must expose an `isSaving` flag -- currently does NOT, addressed in P0.6)
    - MCP is single-threaded (stdio JSON-RPC). WebSocket event callbacks fire on the same event loop but cannot interrupt a synchronous `withRecording()` block. Queue processing defers via `PushPullQueue.pull()` which is async — naturally yields to the event loop between items.
    - Multiple rapid `update` events must be processed sequentially, not in parallel
    - Self-update filtering: check `session.pendingSavedRevisionNum` BEFORE enqueuing to skip our own echoed saves (see P0.6)
    - Branch filtering: skip updates where `rev.branchId !== null` (MCP does not support branches yet; Studio filters at StudioCtx.tsx lines 4130-4137)

### P0.3 -- Incremental Update Fetcher (API Client Extension)

- [ ] **Add `getModelUpdates()` to `api-client.ts`** -- new method matching Studio's `SharedApi.getModelUpdates()`. Calls `GET /api/v1/projects/{projectId}/updates?revisionNum={N}&installedDeps={uuids}` and returns the typed response.
  - Files: modify `packages/plasmic-mcp/src/api-client.ts`, modify `packages/plasmic-mcp/src/types.ts` (add response types)
  - Dependencies: P0.0 (needs `bundler.allUuids()` type)
  - Complexity: **S**
  - Key design decisions:
    - Response shape is a discriminated union:
      1. `{ data: string, revision: number, depPkgs: Array<{ model: string; id: string }>, deletedIids: string[], modifiedComponentIids: string[] }` -- incremental update
      2. `{ needsReload: true }` -- full reload needed
      3. `{ data: null }` -- no changes
    - The `installedDeps` parameter is an array of UUIDs from `bundler.allUuids()`. Must be serialized as a query parameter. The current `api-client.ts` `request()` only supports body params for POST -- need to construct the URL manually for this GET endpoint (or extend `request()` with query param support)
    - Add `branchId?: string` optional parameter for future branch support

### P0.4 -- Rebase Engine

- [ ] **Create `src/rebase-engine.ts`** -- an **orchestration layer** that calls shared Studio functions to implement the rebase algorithm. Does NOT reimplement conflict resolution — imports `undoChangesAndResolveConflicts()`, `undoChanges()`, `updateSummaryFromDeletedInstances()`, `getEmptyDeletedAssetsSummary()`, `taggedUnbundle()`, `trackComponentRoot()`, `trackComponentSite()`, `arrayReversed()`, and `xDifference()` from `@/wab/shared/`. Mirrors `StudioCtx.fetchUpdatesInternal()` (lines 6389-6577) step-for-step.
  - Files: create `packages/plasmic-mcp/src/rebase-engine.ts`
  - Dependencies: P0.0, P0.3
  - Complexity: **XL**
  - Key design decisions:
    - **Two categories of unsaved changes (matching Studio exactly):**
      - Undo stack entries (committed operations) -- analogous to Studio's `_changeRecords`
      - Batch accumulated changes (if batch is open) -- analogous to Studio's `_queuedUnloggedChanges`
    - **Rebase algorithm (mirroring StudioCtx.tsx lines 6453-6525 step-for-step):**
      1. Undo batch accumulated changes via `undoChanges()` (from `@/wab/shared/core/undo-util`, already imported by MCP)
      2. Undo each undo stack entry in reverse order via `undoChanges()`, using `arrayReversed()` (from `@/wab/shared/collections`)
      3. Record `previousProjectDeps` from `site.projectDependencies`
      4. Build `DeletedAssetsSummary` from server's `deletedIids` via `updateSummaryFromDeletedInstances()` (from `@/wab/shared/server-updates-utils`)
      5. Apply server changes inside `recorder.withRecording()`: unbundle `depPkgs` via `taggedUnbundle()` (from `@/wab/shared/core/tagged-unbundle`, already imported by MCP), then `bundler.unbundlePartial(JSON.parse(data), projectId)`
      6. Check for dependency deletion via `xDifference()` (from `@/wab/shared/common`) — if deps removed, throw `UnsupportedServerUpdate` → fall back to full reload (matching Studio lines 6483-6498)
      7. Call `trackComponentRoot(c)` and `trackComponentSite(c, site)` for all components (from `@/wab/shared/core/tpls`, already imported by MCP)
      8. Track saved IIDs: add `Object.keys(partialBundle.map)`, delete `deletedIids`
      9. Re-apply each undo stack entry forward via `undoChangesAndResolveConflicts(site, recorder, summary, changes)` (from `@/wab/shared/server-updates-utils`)
      10. Re-apply batch accumulated changes via `undoChangesAndResolveConflicts()`
    - **Undo stack: full per-entry rebuild (matching Studio).** Each entry is individually rebased so that undo continues to work after remote updates. The undo-manager needs `getStack(): UndoOperation[]` and `replaceStack(stack: UndoOperation[])` accessors.
    - **Batch manager interaction:** `getAccumulatedChanges()` returns `currentBatch?.accumulatedChanges` directly (not a clone — confirmed by code review). After rebase, write back the rebased changes directly. Add `replaceAccumulatedChanges(changes: RecordedChanges)` setter to batch-manager.
    - **Deleted assets summary accumulator:** Store on session as `serverUpdatesSummary`. Accumulates across rebases, cleared only on full reload. Matches Studio's `_serverUpdatesSummary`.
    - If `needsReload: true` or `UnsupportedServerUpdate` thrown, fall back to full project reload (same as `project.refresh`)
    - Update `session.revisionNum` to server's new revision after successful rebase
  - **Shared code imported (not reimplemented):**
    - `undoChangesAndResolveConflicts` — `@/wab/shared/server-updates-utils` (line 245)
    - `getEmptyDeletedAssetsSummary` — `@/wab/shared/server-updates-utils` (line 137)
    - `updateSummaryFromDeletedInstances` — `@/wab/shared/server-updates-utils` (line 156)
    - `undoChanges` — `@/wab/shared/core/undo-util` (already in MCP)
    - `taggedUnbundle` — `@/wab/shared/core/tagged-unbundle` (already in MCP)
    - `trackComponentRoot`, `trackComponentSite` — `@/wab/shared/core/tpls` (already in MCP)
    - `arrayReversed` — `@/wab/shared/collections` (line 193)
    - `xDifference` — `@/wab/shared/common` (line 1039)

### P0.5 -- Integration into Session Lifecycle

- [ ] **Wire socket into `project.set` and `project.refresh`** -- connect socket when project is loaded, disconnect when switching projects or clearing session. Handle `initServerInfo` to detect schema/bundle version mismatches.
  - Files: modify `packages/plasmic-mcp/src/server.ts` (project.set at ~line 345 and project.refresh at ~line 537), modify `packages/plasmic-mcp/src/session.ts`
  - Dependencies: P0.1, P0.2, P0.4
  - Complexity: **L**
  - Key design decisions:
    - Socket connection should be non-blocking: if it fails, log a warning and continue with HTTP-only behavior
    - On `project.set`: connect socket AFTER `setSession()` (line 368) and `initChangeTracker()` (line 385)
    - On `project.refresh`: disconnect old socket, then reconnect after reload
    - On `clearSession()`: disconnect socket
    - **Session state additions needed** (session.ts currently has zero socket fields):
      - `selfPlayerId?: number` -- from `initServerInfo` event
      - `pendingSavedRevisionNum?: number` -- for self-update detection
      - `serverUpdatesSummary?: any` -- accumulated `DeletedAssetsSummary`
      - `isAtTip?: boolean` -- defaults to `true`, set `false` on schema mismatch
    - Handle `initServerInfo`: compare `modelSchemaHash` (imported from `@/wab/shared/model/classes-metas`) and `bundleVersion` (on session). If mismatched, set `isAtTip = false` and warn
    - Handle `hostlessDataVersionUpdate`: if `data.hostlessDataVersion > session.hostlessDataVersion`, log warning

### P0.6 -- Save Manager Coordination

- [ ] **Coordinate saves with incoming updates** -- save-manager must signal when actively saving so update queue pauses, and handle self-update echoes.
  - Files: modify `packages/plasmic-mcp/src/save-manager.ts`, modify `packages/plasmic-mcp/src/update-queue.ts`
  - Dependencies: P0.2, P0.5
  - Complexity: **M**
  - Key design decisions:
    - **Add `isSaving` flag** to `SaveManager`. Set `true` before HTTP request, `false` in `finally` block
    - **Self-update detection (matching StudioCtx.tsx lines 4146-4167):** Before sending save, set `session.pendingSavedRevisionNum = newRevisionNum`. When socket `update` handler sees `pendingSavedRevisionNum >= revisionNum`, skip the update. When `pendingSavedRevisionNum === revisionNum`, clear the pending flag.
    - **Auto-rebase on 412 ProjectRevisionError:** Currently `save-manager.ts` lines 117-120 throw "use refresh-project". With WebSocket: (a) call rebase engine to fetch updates, (b) retry save once. If retry also fails, then throw. Transforms "user manually refreshes" to "automatic recovery".
    - **Save-during-rebase prevention:** If rebase is in progress, save must wait. Can use the update queue's sequential processing or an `isRebasing` flag.

### P0.7 -- Socket Client Unit Tests

- [ ] **Create `src/__tests__/socket-client.test.ts`** -- unit tests with mocked socket.io-client. Cover: connection with correct headers (including Basic Auth), subscribe flow, event handling, reconnection, disconnect on session clear.
  - Files: create `packages/plasmic-mcp/src/__tests__/socket-client.test.ts`
  - Dependencies: P0.1
  - Complexity: **M**

### P0.8 -- Update Queue Unit Tests

- [ ] **Create `src/__tests__/update-queue.test.ts`** -- unit tests for sequential processing, save-in-flight gating, rapid event queuing, self-update filtering, branch filtering. Uses mocked `PushPullQueue` from the asyncutil mock.
  - Files: create `packages/plasmic-mcp/src/__tests__/update-queue.test.ts`
  - Dependencies: P0.2
  - Complexity: **M**

### P0.9 -- Rebase Engine Unit Tests

- [ ] **Create `src/__tests__/rebase-engine.test.ts`** -- unit tests covering: simple rebase (no local changes), rebase with undo stack entries (per-entry rebuild matching Studio), rebase with open batch changes, `needsReload` fallback, conflict resolution failure fallback, dependency deletion detection via `xDifference`, revision number update, `DeletedAssetsSummary` accumulation across rebases.
  - Files: create `packages/plasmic-mcp/src/__tests__/rebase-engine.test.ts`
  - Dependencies: P0.0, P0.4
  - Complexity: **L**

---

## P1 -- WebSocket Presence

Once the socket connection exists (P0), presence allows Studio users to see the AI agent as a collaborator and track what it is editing.

### P1.1 -- Presence Manager

- [ ] **Create `src/presence-manager.ts`** -- manages emitting `view` events with `UpdatePlayerViewRequest` data. **Imports `UpdatePlayerViewRequest`, `ArenaInfo`, `ArenaType` from `@/wab/shared/ApiSchema`** and **`getArenaType`, `getArenaUuidOrName` from `@/wab/shared/Arenas`** — same types and helpers Studio uses. Provides `updateArena(componentUuid, arenaType)`, `updateSelection(frameUuid, selectableKey)`, `clearPresence()`. Debounces emissions (200ms).
  - Files: create `packages/plasmic-mcp/src/presence-manager.ts`
  - Dependencies: P0.0 (needs ApiSchema and Arenas declarations), P0.1, P0.5
  - Complexity: **M**
  - Key design decisions:
    - `UpdatePlayerViewRequest`: `{ projectId, branchId: null, arena: ArenaInfo | null, selection: PlayerSelectionInfo | null, cursor: null, position: null }`. MCP has no cursor or viewport.
    - `ArenaInfo`: `{ type: ArenaType, uuidOrName: string, focused: false }`. Derive `type` using `getArenaType()` from `@/wab/shared/Arenas` or from `component.pageMeta` presence.
    - `PlayerSelectionInfo`: `{ selectableFrameUuid: string, selectableKey?: string }`. For node-level operations, use node UUID as selectableKey.
    - Debounce via `setTimeout` (200ms), not MobX autorun.
  - **Shared code imported (not reimplemented):**
    - `UpdatePlayerViewRequest`, `ArenaInfo`, `ArenaType`, `InitServerInfo` — `@/wab/shared/ApiSchema`
    - `getArenaType`, `getArenaUuidOrName` — `@/wab/shared/Arenas`

### P1.2 -- Hook Presence into Edit Tools

- [ ] **Emit presence updates in edit tool execution paths** -- before each edit tool executes, update arena info to target component. During node mutations, update selection info. After operation, clear selection.
  - Files: modify `packages/plasmic-mcp/src/server.ts` (tool handlers), possibly create `src/tool-lifecycle.ts` wrapper
  - Dependencies: P1.1
  - Complexity: **L**
  - Key design decisions:
    - Use a lifecycle wrapper: `withPresence(componentUuid, nodeRef?, fn)` that emits view events before/after
    - Presence updates work during batch operations: update arena info as focus moves between components
    - For read-only operations (inspect tools), emit arena info but no selection
    - Debouncing prevents flooding on rapid successive calls

### P1.3 -- Presence Manager Unit Tests

- [ ] **Create `src/__tests__/presence-manager.test.ts`** -- unit tests covering: view event emission, debouncing, arena info construction using imported `ArenaType`/`ArenaInfo` types, selection info construction, clear on disconnect, batch operation presence.
  - Files: create `packages/plasmic-mcp/src/__tests__/presence-manager.test.ts`
  - Dependencies: P1.1
  - Complexity: **M**

---

## P2 -- Test Coverage Improvements

### P2.1 -- Edit Tools Edge Case Coverage

- [ ] **Add edge case tests for complex edit-tools functions** -- focus on `extractToComponent`, `convertToPage`, `convertToComponent`, `setDataRep`, `setDataCond`, `uploadAsset`, `setImage`, and data domain functions (`createSplit`, `updateSplit`, `removeSplit`).
  - Files: augment `packages/plasmic-mcp/src/__tests__/node.test.ts`, `component.test.ts`, `data.test.ts`
  - Dependencies: None
  - Complexity: **L**

### P2.2 -- Pattern Applier Direct Tests

- [ ] **Expand `pattern-library.test.ts` with direct applier tests** -- test `applyCustomisations` with more complex customisation trees (nested children, slot overrides, variant-specific styles).
  - Files: augment `packages/plasmic-mcp/src/__tests__/pattern-library.test.ts`
  - Dependencies: None
  - Complexity: **S**

### P2.3 -- Save Manager Conflict Retry Tests

- [ ] **Add 412 auto-retry test scenarios** -- test the `ProjectRevisionError` -> fetch updates -> rebase -> retry flow (from P0.6). Also test the existing `UnknownReferencesError` -> full bundle fallback path with more detailed assertions.
  - Files: augment `packages/plasmic-mcp/src/__tests__/save-manager.test.ts`
  - Dependencies: P0.6
  - Complexity: **M**

---

## P3 -- Future Considerations

### P3.1 -- Branch-Aware Socket Subscriptions

- [ ] **Support branch-specific update filtering** -- the socket `update` event includes `rev.branchId`. When the MCP supports branch operations, filter updates to only process those for the active branch.
  - Files: modify `packages/plasmic-mcp/src/socket-client.ts` or `update-queue.ts`
  - Dependencies: P0.1, P0.2
  - Complexity: **S**

### P3.2 -- Comments Sync

- [ ] **Handle `commentsUpdate` socket events** -- if the MCP adds comment-reading tools, it would need to refresh its comment cache on these events. Currently out of scope.
  - Files: modify `packages/plasmic-mcp/src/socket-client.ts`
  - Dependencies: P0.1
  - Complexity: **S**

### P3.3 -- Publish Notifications

- [ ] **Handle `publish` socket events** -- detect when a project is published and update any cached package version info. Currently out of scope.
  - Files: modify `packages/plasmic-mcp/src/socket-client.ts`
  - Dependencies: P0.1
  - Complexity: **S**

### P3.4 -- Configurable Agent Display Name

- [ ] **Allow custom player identity** -- use env var (`PLASMIC_AGENT_NAME`) to set a display name in Studio's collaborator list. Currently out of scope. Note: player display name is determined server-side from the user account associated with the API token; limited value without server-side changes.
  - Files: modify `packages/plasmic-mcp/src/presence-manager.ts`
  - Dependencies: P1.1
  - Complexity: **S**

---

## Implementation Sequence

```
P0.0 (prerequisites) ---+--- P0.1 (socket-client)
                         |
                         +--- P0.2 (update-queue)
                         |
                         +--- P0.3 (API extension) ---+--- P0.4 (rebase-engine)
                                                       |
                                                       +--- P0.5 (session integration)
                                                       |
                                                       +--- P0.6 (save coordination)
                                                       |
P0.7 (socket tests) -- after P0.1                     +--- P1.1 (presence manager)
P0.8 (queue tests) -- after P0.2                      |      +--- P1.2 (edit tool hooks)
P0.9 (rebase tests) -- after P0.4                     |             +--- P1.3 (presence tests)
                                                       |
P2.1 (edit-tools edge cases) -- independent            |
P2.2 (pattern applier tests) -- independent            |
P2.3 (save retry tests) -- depends on P0.6 -----------+
```

**Key change from original:** P0.1 and P0.2 are independent of each other (both depend only on P0.0). They can be built in parallel.

**Recommended merge order:**
1. **P0.0** (prerequisites: type declarations, mocks, shared code imports, ChangeTracker accessor -- unblocks everything)
2. **P0.3** (small API method addition to api-client.ts)
3. **P0.1 + P0.7** (socket client with tests)
4. **P0.2 + P0.8** (update queue with tests — wraps imported PushPullQueue)
5. **P0.4 + P0.9** (rebase engine with tests -- orchestrates imported shared functions, largest unit of work)
6. **P0.5 + P0.6** (integration into session lifecycle and save coordination)
7. **P1.1 + P1.3** (presence manager with tests — uses imported ApiSchema/Arenas types)
8. **P1.2** (presence hooks into edit tools)
9. **P2.x** (test coverage improvements -- can be done any time)

---

## Shared Code Reuse Summary

The MCP rebase/sync system reuses Studio's shared code rather than reimplementing:

| Function | Source | Used by |
|----------|--------|---------|
| `undoChangesAndResolveConflicts()` | `@/wab/shared/server-updates-utils` | P0.4 (rebase engine) |
| `getEmptyDeletedAssetsSummary()` | `@/wab/shared/server-updates-utils` | P0.4 (rebase engine) |
| `updateSummaryFromDeletedInstances()` | `@/wab/shared/server-updates-utils` | P0.4 (rebase engine) |
| `undoChanges()` | `@/wab/shared/core/undo-util` | P0.4 (already in MCP) |
| `taggedUnbundle()` | `@/wab/shared/core/tagged-unbundle` | P0.4 (already in MCP) |
| `trackComponentRoot()`, `trackComponentSite()` | `@/wab/shared/core/tpls` | P0.4 (already in MCP) |
| `arrayReversed()` | `@/wab/shared/collections` | P0.4 (rebase engine) |
| `xDifference()` | `@/wab/shared/common` | P0.4 (rebase engine) |
| `PushPullQueue`, `drainQueue()` | `@/wab/commons/asyncutil` | P0.2 (update queue) |
| `ClientToServerEvents`, `ServerToClientEvents` | `@/wab/shared/api/socket` | P0.1 (socket client) |
| `UpdatePlayerViewRequest`, `ArenaInfo`, `ArenaType` | `@/wab/shared/ApiSchema` | P1.1 (presence) |
| `getArenaType()`, `getArenaUuidOrName()` | `@/wab/shared/Arenas` | P1.1 (presence) |

---

## Risks and Open Questions

### R1: `server-updates-utils.ts` Transitive Import Cost
`undoChangesAndResolveConflicts()` lives in `@/wab/shared/server-updates-utils.ts`, which imports from `@/wab/shared/Arenas`, `@/wab/commons/StyleToken`, `@/wab/shared/core/image-assets`, `@/wab/shared/core/tokens`, etc. esbuild will bundle these transitively. Could add 100-300KB to the ~1.3MB bundle. Measure after P0.4.

### R2: Query Parameter Encoding for `getModelUpdates`
`api-client.ts` `request()` doesn't support query parameters on GET. Need to either extend `request()` or manually construct the URL. The `installedDeps` array (from `bundler.allUuids()`) must be serialized as a query param.

### R3: Undo Stack Mutability for Rebase
The undo-manager needs `getStack()` and `replaceStack()` accessors so the rebase engine can revert and re-apply each entry individually. Currently the stack is module-private (`let undoStack: UndoOperation[] = []`). Small change but must be done carefully to preserve existing undo behavior.

### R4: `PushPullQueue` Dependency on `async` npm Package
`PushPullQueue` in `@/wab/commons/asyncutil.ts` may use the `async` npm package's `AsyncQueue`. Verify this dependency is available in the MCP's build environment, or that esbuild bundles it transitively.

---

## Critical Reference Files
- `platform/wab/src/wab/shared/api/socket.ts` -- socket event type definitions (ClientToServerEvents, ServerToClientEvents)
- `platform/wab/src/wab/server/routes/projects-socket.ts` -- server-side socket handler (subscribe at line 169, view at line 195, auth at lines 300-361, initServerInfo at lines 242-247)
- `platform/wab/src/wab/shared/ApiSchema.ts` -- UpdatePlayerViewRequest, ArenaInfo, InitServerInfo types
- `platform/wab/src/wab/shared/Arenas.ts` -- getArenaType (line 163), getArenaUuidOrName (line 177)
- `platform/wab/src/wab/shared/server-updates-utils.ts` -- undoChangesAndResolveConflicts (line 245), DeletedAssetsSummary (line 120), updateSummaryFromDeletedInstances (line 156)
- `platform/wab/src/wab/shared/core/observable-model.ts` -- IChangeRecorder interface, ChangeRecorder class
- `platform/wab/src/wab/shared/bundler.ts` -- FastBundler.unbundlePartial, allUuids, objByAddr
- `platform/wab/src/wab/shared/collections.ts` -- arrayReversed (line 193)
- `platform/wab/src/wab/shared/common.ts` -- xDifference (line 1039)
- `platform/wab/src/wab/commons/asyncutil.ts` -- PushPullQueue (line 21), drainQueue (line 11)
- `platform/wab/src/wab/client/studio-ctx/StudioCtx.tsx` -- Studio's reference: startListeningForSocketEvents (line 4025), fetchUpdatesInternal (line 6389), update handler (line 4126), pendingSavedRevisionNum (line 4146)
