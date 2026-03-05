# WebSocket Presence

## Jobs to Be Done

- As a Studio user, I want to see the AI agent as a named collaborator in the multiplayer UI so that I know an AI is connected to my project
- As a Studio user, I want to see which component/page the AI agent is currently editing so that I can avoid conflicting edits
- As a Studio user, I want to see what elements the AI agent has selected so that I have full visibility into its activity

## Acceptance Criteria

- [ ] On socket subscribe, MCP emits `view` events with `UpdatePlayerViewRequest` data so it appears in Studio's multiplayer player list
- [ ] Player identity shows as "AI Agent" (or similar distinguishable name) in Studio's collaborator display
- [ ] When MCP starts editing a component, updates `arenaInfo` in the view event with the component's arena type and UUID
- [ ] When MCP selects/focuses on a node (during edit operations), updates `selectionInfo` in the view event
- [ ] View events are debounced (not sent on every micro-operation) to avoid flooding the socket
- [ ] When MCP finishes an edit operation, clears selection info
- [ ] When MCP disconnects, Studio removes it from the player list (handled automatically by socket disconnect)
- [ ] Presence works correctly during batch operations (shows the component being edited throughout the batch)

## Happy Path

1. MCP connects to socket and subscribes to project room
2. Studio users see "AI Agent" appear in their collaborator list
3. MCP user calls an edit tool targeting a specific component
4. MCP emits `view` event with the component's arena info
5. Studio users see the AI agent's focus indicator on that component
6. MCP selects a node within the component for editing
7. MCP emits updated `view` event with selection info
8. Studio users see the AI agent's selection highlight
9. MCP completes the edit and saves
10. MCP clears selection, emits updated `view` event
11. Studio users see the AI agent's selection clear

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| MCP edits multiple components in a batch | Update arenaInfo as focus moves between components |
| MCP is doing read-only inspection | Emit view with arenaInfo of inspected component but no selection |
| Socket disconnects mid-edit | Studio removes AI from player list. On reconnect, re-emit current view state. |
| No component context (e.g. project-level operations) | Emit view with null arenaInfo (player visible but no focus) |
| Rapid successive edits to different nodes | Debounce view emissions to avoid flooding |

## Out of Scope

- Cursor position tracking (MCP has no visual cursor; leave cursorInfo as null)
- Viewport/position tracking (MCP has no viewport; leave positionInfo as null)
- "Watch player" following (Studio feature for following another user's navigation)
- Custom player display name configuration
