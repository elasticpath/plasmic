# Implementation Plan

_Last updated: 2026-03-05 (P0 complete, P1 complete, P2 complete, P3.1 complete)_

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

---

## P2 -- Test Coverage Improvements ✅ COMPLETED

All P2 items complete (P2.1-P2.3). 92 tests added across edit-tools edge cases, pattern applier, and save-manager conflict retry.

---

## P3 -- Future Considerations

### P3.1 -- Branch-Aware Socket Subscriptions ✅ COMPLETED

Added `activeBranchId` field to Session interface and branch-aware filtering to UpdateQueue, presence-manager, and live-sync. When `activeBranchId` is null (default), only main-branch updates are processed — matching prior behavior. When set to a branch ID string, only updates for that branch are accepted and presence view events include the correct branchId.

10 new tests covering: active branch matching, main-branch rejection from feature branch, different-branch rejection, dynamic branch switching, presence branchId emission (null default, explicit branch, branch changes between emissions), live-sync branch routing (3 tests). Total tests: 2,021 (up from 2,011).

Files: `packages/plasmic-mcp/src/{session,update-queue,presence-manager,live-sync}.ts`, `packages/plasmic-mcp/src/__tests__/{update-queue,presence-manager,live-sync}.test.ts`.

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
