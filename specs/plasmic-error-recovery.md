# Error Recovery and Resilience

## Jobs to Be Done
- As a Claude Code user, I want failed `update-styles` calls to NOT leave the model dirty so that I don't need to call `refresh-project` after every error
- As a Claude Code user, I want `list-projects` to return helpful errors instead of "Internal Server Error"

## Background

### Dirty State After Failures
When `updateStyles()` (or any mutation) fails after changes are recorded by `withRecording()`, the model has already been mutated in memory. If the subsequent save fails, the model is left in a dirty state — tracked changes exist that haven't been saved, and subsequent operations may fail or produce unexpected results. The only recovery is `refresh-project`.

### API Error Details
`list-projects` and other API calls return the server's raw error message on failure. For 5xx errors, this is often unhelpful ("Internal Server Error"). No retry logic or timeout exists.

## Acceptance Criteria

- [ ] When `updateStyles()` fails during save, the in-memory changes are automatically reverted (rolled back) before the error is returned
- [ ] When `updateText()` fails during save, same automatic rollback applies
- [ ] When `addChild()` fails during validation (e.g., invalid tag), no model changes are recorded
- [ ] Failed mutations do NOT accumulate in the change tracker — after an error, the model is clean
- [ ] After a failed mutation, the next mutation succeeds without needing `refresh-project`
- [ ] API client adds request timeout (30s default) to prevent hanging requests
- [ ] API client errors for 5xx include the HTTP status code and a suggestion to retry
- [ ] `list-projects` error includes specific guidance (check auth, check server availability)
- [ ] Unit tests verify rollback on save failure
- [ ] Unit tests verify clean state after rolled-back mutation

## Happy Path
1. User calls `update-styles` with a valid property
2. Changes are recorded, save succeeds, revision increments
3. If save had failed: changes would be auto-reverted, error returned, model remains clean
4. User's next call works without needing `refresh-project`

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Save fails with 412 (conflict) | Rollback changes, return error suggesting `refresh-project` |
| Save fails with 5xx | Rollback changes, return error with retry suggestion |
| Save fails with network timeout | Rollback changes, return error with connectivity guidance |
| Batch mode: one operation fails mid-batch | Cancel batch, rollback all accumulated changes |
| Validation failure before mutation | No model changes recorded, clean error returned |
| Double failure: rollback itself fails | Log error, suggest `refresh-project` as last resort |

## Out of Scope
- Automatic retry with exponential backoff (can add later)
- Optimistic locking or conflict resolution beyond 412 handling
- Offline/queue mode for mutations
