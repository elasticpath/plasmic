# Implementation Plan

_Last updated: 2026-03-05 (P0 complete, P1.1+P1.2+P1.3 complete)_

## Status Legend
- `[ ]` Not started
- Priority: **P0** Critical | **P1** High | **P2** Medium | **P3** Low
- Complexity: **S** Small (< 1 day) | **M** Medium (1-2 days) | **L** Large (3-5 days) | **XL** Extra Large (5+ days)

---

## P0 -- WebSocket Live Sync (Core) ✅ COMPLETED

All P0 items are complete. The MCP server now receives real-time `update` events via socket.io and rebases the in-memory model, exactly as Studio does.

- **P0.0** -- Prerequisites: Type Declarations, Mocks, and Shared Code Imports ✅
- **P0.1** -- Socket.io Client Module ✅
- **P0.2** -- Update Queue and Serialization ✅
- **P0.3** -- Incremental Update Fetcher (API Client Extension) ✅
- **P0.4** -- Rebase Engine ✅
- **P0.5** -- Integration into Session Lifecycle ✅
- **P0.6** -- Save Manager Coordination ✅
- **P0.7** -- Socket Client Unit Tests ✅
- **P0.8** -- Update Queue Unit Tests ✅
- **P0.9** -- Rebase Engine Unit Tests ✅
- **P0.10** -- Live Sync Integration Tests ✅

**Note:** Auto-rebase on 412 ProjectRevisionError deferred to P2.3.

---

## P1 -- WebSocket Presence

Once the socket connection exists (P0), presence allows Studio users to see the AI agent as a collaborator and track what it is editing.

### P1.1 -- Presence Manager ✅ COMPLETED

Created `src/presence-manager.ts` — emits `view` events with `UpdatePlayerViewRequest` data so Studio users see the MCP agent as a collaborator. Imports `ArenaType`, `ArenaInfo`, `PlayerSelectionInfo`, `UpdatePlayerViewRequest` from `@/wab/shared/ApiSchema`. Provides `updateArena(componentUuid, arenaType)`, `updateSelection(frameUuid, selectableKey?)`, `clearPresence()`, `clearSelection()`, `emitViewNow()`, `resetPresence()`. Debounces at 200ms via `setTimeout`. MCP sets `cursor: null`, `position: null`, `branchId: null`, `focused: false` — no cursor/viewport/branch support.

**Note:** Does not import `getArenaType`/`getArenaUuidOrName` from `@/wab/shared/Arenas` — the presence manager receives the arena type and UUID directly from the caller (tool handlers will resolve these in P1.2).

### P1.2 -- Hook Presence into Edit Tools ✅ COMPLETED

Created `src/tool-presence.ts` with three exported functions:
- `emitEditPresence(componentUuid, nodeRef?)` — sets arena to the target component (detecting page vs component type) and optionally resolves nodeRef to a UUID for selection info
- `clearEditPresence()` — clears selection (preserves arena for batch continuity)
- `emitInspectPresence(componentUuid)` — sets arena only for read-only operations

Integrated into all 7 tool handlers in `server.ts`:
- **inspect**: `emitInspectPresence` at handler entry for component-targeted actions (tree, summary, node, subtree, export, preview-url, page-meta)
- **component**: `emitEditPresence` + `finally { clearEditPresence() }` for component-level operations
- **node**: `emitEditPresence` with `nodeRef ?? parentRef` + `finally` cleanup for all node mutations
- **variant**: `emitEditPresence` + `finally` for component-scoped variant actions
- **data**: `emitEditPresence` with `nodeRef` + `finally` for component-targeted data operations
- **interaction**: `emitEditPresence` with `nodeRef` + `finally` for all interaction actions
- **design/project**: No presence (site-level operations with no component context)

19 unit tests in `tool-presence.test.ts` covering: arena type detection (page vs component), node resolution with selection, ambiguous/empty/failing resolution graceful degradation, no-session skip, missing component skip, batch component focus transitions, and inspect-only arena emission.

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
