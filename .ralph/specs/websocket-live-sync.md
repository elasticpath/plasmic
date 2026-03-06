# WebSocket Live Sync

## Jobs to Be Done

- As an AI agent (MCP tool), I want to receive real-time notifications when other collaborators save changes so that I can rebase my in-memory model and avoid 412 save conflicts
- As a Studio user (human), I want to see the AI agent as a connected collaborator so that I know when it's actively editing my project and what it's working on

## Acceptance Criteria

- [ ] On `project.set`, the MCP connects a socket.io client to the API host at `/api/v1/socket` using the same auth headers the API client already uses (`x-plasmic-api-user`, `x-plasmic-api-token`)
- [ ] On connect, emits `subscribe` with `{ namespace: "projects", projectIds: [projectId], studio: true }`
- [ ] Listens for `update` events containing `{ projectId, rev: { revision, branchId } }`
- [ ] When an `update` event arrives with a newer revision than session.revisionNum, fetches incremental updates via `GET /projects/{id}/updates` and rebases local changes using the shared `undoChangesAndResolveConflicts()` from `wab/shared/server-updates-utils`
- [ ] Rebase follows Studio's algorithm: revert local changes, apply server partial bundle, re-apply local changes on top with conflict resolution
- [ ] If rebase fails (e.g. `UnsupportedServerUpdate`), falls back to full project reload
- [ ] On `session.clear()` or project switch, disconnects socket and unsubscribes from room
- [ ] socket.io auto-reconnects on disconnect (default behavior); on reconnect, re-subscribes and fetches any missed updates
- [ ] All tool calls continue to work when socket is disconnected (graceful degradation to current HTTP-only behavior)
- [ ] Handles `initServerInfo` event to detect schema/bundle version mismatches (triggers refresh)
- [ ] Handles `hostlessDataVersionUpdate` to detect stale hostless data

## Happy Path

1. User calls `project.set` with a project ID
2. MCP loads the project bundle via HTTP (existing flow)
3. MCP connects socket.io to `{apiHost}/api/v1/socket` with auth headers
4. MCP emits `subscribe` for the project room
5. MCP receives `initServerInfo` with schema hash and bundle version, validates compatibility
6. Another user edits the project in Studio and saves
7. MCP receives `update` event with new revision number
8. MCP calls `GET /projects/{id}/updates?revisionNum=N` to get incremental diff
9. MCP rebases: reverts local unsaved changes, applies server partial, re-applies local changes
10. MCP's in-memory model is now current; next save uses the updated revision number
11. User calls `project.set` with a different project (or clears session)
12. MCP disconnects socket from previous project room, connects to new one

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Socket connection fails on project.set | Log warning, continue with HTTP-only behavior. All tools still work. |
| Update event arrives mid-batch | Rebase accumulated batch changes on top of server update. Batch continues. |
| Update event arrives during active save | Queue the update, process after save completes. |
| getModelUpdates returns `needsReload: true` | Full project reload (same as Studio). Clear undo stack, reload bundle. |
| undoChangesAndResolveConflicts throws | Fall back to full project reload. Log the conflict details. |
| Socket disconnects (network issue) | socket.io auto-reconnects. On reconnect, re-subscribe and fetch missed updates. |
| Multiple rapid update events | Process sequentially via queue (same as Studio's modelChangeQueue pattern). |
| Update event for different branch | Ignore if not on same branch. |
| Schema hash mismatch on initServerInfo | Mark session as not-at-tip, require refresh. |
| MCP has no unsaved changes when update arrives | Simple case: just apply server update, no rebase needed. |

## Out of Scope

- Pre-save streaming of MCP edits to other collaborators (edits are broadcast only on save, same as Studio)
- Multi-project simultaneous socket connections (single session singleton)
- Custom socket server URL configuration (uses API host, same as Studio)
- Comments sync (`commentsUpdate` events)
- Publish notifications (`publish` events)
