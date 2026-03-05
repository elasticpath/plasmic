# Implementation Plan

_Last updated: 2026-03-05 (P0 complete, P1 complete, P2 complete)_

## Status Legend
- `[ ]` Not started
- Priority: **P0** Critical | **P1** High | **P2** Medium | **P3** Low
- Complexity: **S** Small (< 1 day) | **M** Medium (1-2 days) | **L** Large (3-5 days) | **XL** Extra Large (5+ days)

---

## P0 -- WebSocket Live Sync (Core) ✅ COMPLETED

All P0 items complete (P0.0-P0.10). Real-time `update` events via socket.io with in-memory model rebasing.

---

## P1 -- WebSocket Presence ✅ COMPLETED

All P1 items complete (P1.1-P1.3). Studio users see the MCP agent as a collaborator and can track what it is editing in real-time via `src/presence-manager.ts` and `src/tool-presence.ts`.

**Presence lifecycle fixes (2026-03-05):** Fixed two spec discrepancies -- `emitViewNow()` now called on socket reconnect (re-broadcasts presence), `resetPresence()` now called in `stopLiveSync()` (clears state without emitting on disconnect). 2 tests added in `live-sync.test.ts`. Files: `packages/plasmic-mcp/src/live-sync.ts`, `packages/plasmic-mcp/src/__tests__/live-sync.test.ts`.

---

## P2 -- Test Coverage Improvements

### P2.1 -- Edit Tools Edge Case Coverage ✅ COMPLETED

Added 40 edge case tests across 4 test files covering previously under-tested edit-tools functions:

**component.test.ts** (14 new tests):
- `extractToComponent`: TplSlot rejection, WAB extractComponent error propagation
- `convertToPage`: unknown UUID, no-path default, path provided, save/revision, fallback empty path
- `convertToComponent`: unknown UUID, save/revision, TplMgr call verification

**data.test.ts** (16 new tests):
- `removeSplit`: by UUID, revision tracking, case-insensitive name lookup
- `createSplit`: single-slice probability (100), default segment condition, fresh status, unique UUIDs, save/revision
- `updateSplit`: status-only update, name-only update, find by UUID, not-found error, auto-calc probabilities, segment type preservation

**design.test.ts** (7 new tests):
- `uploadAsset`: width/height/aspectRatio passthrough, aspect ratio omission (width-only, height-only), return values, save/revision, network error message, HTTP error status

**node.test.ts** (10 new tests):
- `setImage`: unknown component UUID, unknown node, invalid asset ref, find asset by UUID, variant-aware image, save with component IID, nodeName return, special characters in background CSS, asset dataUri for non-img background

Total tests: 2,011 (up from 1,971). Files: `packages/plasmic-mcp/src/__tests__/{node,component,data,design}.test.ts`.

### P2.2 -- Pattern Applier Direct Tests ✅ COMPLETED

Added 20 direct `applyCustomisations` edge case tests covering: deeply nested substitutions (footer-simple 4 levels), multiple elements matching same key (h2 collision), all heuristic matchers (copyrightText ©, brandName "Brand", titleText h3, actionLabel a, submitLabel button), empty string values, all-undeclared keys, non-array single child path, string element children, leaf nodes, special characters in values, imageSrc on img elements, declared key with no matching element. Total tests: 1,801 (up from 1,778). Files: `packages/plasmic-mcp/src/__tests__/pattern-library.test.ts`.

### P2.3 -- Save Manager Conflict Retry ✅ COMPLETED

Implemented auto-rebase on 412 `ProjectRevisionError` (deferred from P0). `SaveManager` now accepts an optional `rebaseOnConflict` callback. On `ProjectRevisionError`, if the callback is provided, it fetches server updates, rebases local changes, and retries with a full bundle save. Exported `rebaseFromServer()` from `live-sync.ts` for callers to wire up. Wired into `edit-tools.ts`, `batch-manager.ts`, `undo-manager.ts` (the main mutation paths).

25 new tests covering: rebase+retry success, updated revision after rebase, rebase failure with detailed error, retry failure (no double-retry), backward compat without callback, `SchemaMismatchError` exclusion, `UnknownReferencesError` exclusion, logging, `isSaving` flag lifecycle during rebase, `UnknownReferencesError` detailed assertions (bundleVersion fetch, fresh version, session update, revision increment, retry failure propagation), non-412 error passthrough. Total tests: 1,778 (up from 1,758).

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
