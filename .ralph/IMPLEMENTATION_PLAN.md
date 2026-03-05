# Implementation Plan

_Last updated: 2026-03-05 (P0 complete, P1.1+P1.3 complete)_

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

### P0.1 -- Socket.io Client Module ✅ COMPLETED

Created `src/socket-client.ts` with injectable factory pattern for testability. Connects to `{apiHost}/api/v1/socket` with WebSocket transport, same auth headers as api-client.ts. Emits `subscribe` with `studio: true` on `initServerInfo`. Handles `update`, `hostlessDataVersionUpdate`, `error` events. Re-subscribes on `io.reconnect`. Added `socket.io-client@^4.1.2` to dependencies.

### P0.2 -- Update Queue and Serialization ✅ COMPLETED

Created `src/update-queue.ts` wrapping `PushPullQueue` with pre-enqueue filtering (branch, self-update), save-in-flight gating (polls `isSaving()` at 50ms), and sequential processing. `stop()` pushes sentinel to unblock pending `pull()`.

### P0.3 -- Incremental Update Fetcher (API Client Extension) ✅ COMPLETED

Added `getModelUpdates()` to `api-client.ts` calling `GET /api/v1/projects/{id}/updates` with `URLSearchParams`. Added `ModelUpdateIncremental`, `ModelUpdateNeedsReload`, `ModelUpdateNoChanges`, and `GetModelUpdatesResponse` union type to `types.ts`. Also added `getAuth()` public accessor.

### P0.4 -- Rebase Engine ✅ COMPLETED

Created `src/rebase-engine.ts` — pure orchestration layer mirroring `StudioCtx.fetchUpdatesInternal()`. Implements 5-phase rebase: revert local changes → record server deletions → apply server partial bundle → check dependency deletion → re-apply local with conflict resolution. `applyServerUpdate()` separated from `fetchAndRebase()` for testability. Throws `UnsupportedServerUpdate` for needsReload and dependency deletion cases.

### P0.5 -- Integration into Session Lifecycle ✅ COMPLETED

Created `src/live-sync.ts` integration module. Added `selfPlayerId`, `pendingSavedRevisionNum`, `serverUpdatesSummary`, `isAtTip` fields to Session. Wired `startLiveSync()`/`stopLiveSync()` into `project.set` and `project.refresh` in server.ts. Socket connection is non-blocking (`.catch()` logs warning, continues HTTP-only). `initServerInfo` handler detects schema/bundle version mismatches. `hostlessDataVersionUpdate` handler updates session.

### P0.6 -- Save Manager Coordination ✅ COMPLETED

Added module-level `isSaving()` flag to save-manager.ts (set true before HTTP call, false in `finally`). Both `saveChanges()` and `saveFullBundle()` set `session.pendingSavedRevisionNum` before save for self-update echo detection. Update queue uses `isSaving()` to pause processing during saves.

**Note:** Auto-rebase on 412 ProjectRevisionError deferred to P2.3 — requires integration testing with a real server. Current behavior still throws with guidance to use refresh-project.

### P0.7 -- Socket Client Unit Tests ✅ COMPLETED

12 tests covering: auth headers, Basic Auth, subscribe flow on initServerInfo, event routing (update, hostlessDataVersionUpdate, error), reconnection re-subscribe, disconnect state clearing, connection failure graceful degradation.

### P0.8 -- Update Queue Unit Tests ✅ COMPLETED

10 tests covering: sequential processing, concurrency=1, branch filtering, self-update filtering, save-in-flight gating, error resilience, stop sentinel.

### P0.9 -- Rebase Engine Unit Tests ✅ COMPLETED

14 tests covering: no-changes null return, needsReload exception, simple fast-forward, undo stack per-entry rebuild, batch changes rebase, combined undo+batch, dependency deletion detection, deleted instances IID resolution, dep pkg unbundling, revision number update, DeletedAssetsSummary accumulation.

### P0.10 -- Live Sync Integration Tests ✅ COMPLETED

13 tests in `live-sync.test.ts` covering: start/stop lifecycle, serverUpdatesSummary initialization, no-session skip, previous-sync cleanup, initServerInfo schema/bundle mismatch detection, hostless data version update, update event routing through queue, different-project filtering. 4 tests in `save-manager.test.ts` covering: isSaving flag, pendingSavedRevisionNum tracking.

---

## P1 -- WebSocket Presence

Once the socket connection exists (P0), presence allows Studio users to see the AI agent as a collaborator and track what it is editing.

### P1.1 -- Presence Manager ✅ COMPLETED

Created `src/presence-manager.ts` — emits `view` events with `UpdatePlayerViewRequest` data so Studio users see the MCP agent as a collaborator. Imports `ArenaType`, `ArenaInfo`, `PlayerSelectionInfo`, `UpdatePlayerViewRequest` from `@/wab/shared/ApiSchema`. Provides `updateArena(componentUuid, arenaType)`, `updateSelection(frameUuid, selectableKey?)`, `clearPresence()`, `clearSelection()`, `emitViewNow()`, `resetPresence()`. Debounces at 200ms via `setTimeout`. MCP sets `cursor: null`, `position: null`, `branchId: null`, `focused: false` — no cursor/viewport/branch support.

**Note:** Does not import `getArenaType`/`getArenaUuidOrName` from `@/wab/shared/Arenas` — the presence manager receives the arena type and UUID directly from the caller (tool handlers will resolve these in P1.2).

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

### P1.3 -- Presence Manager Unit Tests ✅ COMPLETED

18 tests in `presence-manager.test.ts` covering: view event emission with correct UpdatePlayerViewRequest shape, arena info construction (component/page types), selection info with/without selectableKey, debounce coalescing (rapid updates → single emission), debounce timer reset, emitViewNow bypass, clearPresence/clearSelection, resetPresence without emission, no-socket graceful degradation, no-session skip, batch operation presence across components, read-only inspection (arena without selection).

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
