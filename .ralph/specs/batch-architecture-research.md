# Batch Architecture Redesign — Implicit Micro-Batch

## Jobs to Be Done
- As a tool consumer making multiple parallel MCP calls, I want errors in one call to not destroy the work done by sibling calls, so that I don't waste time re-applying valid changes after unrelated failures.
- As a system architect, I want the MCP's atomicity model to be well-reasoned and match industry patterns, so the server is predictable and robust.

## Context

**Gap #35 (Major).** The current explicit `begin-batch`/`end-batch` architecture provides atomicity (N operations = 1 revision) but zero error isolation. If ANY mutation fails mid-batch, `cancelBatchWithRollback()` reverts ALL accumulated changes — even previously-successful ones.

### Current behavior (broken)
```
begin-batch
  Call A (update-styles, valid)      → accumulated ✓
  Call B (set-visibility, bad param) → ERROR → cancelBatchWithRollback → A's work destroyed
  Call C (update-styles, valid)      → CANCELLED (batch already dead)
```

### Research findings

| Server | Approach | Atomicity | Error Isolation |
|--------|----------|-----------|-----------------|
| **MCP Spec** | No transaction semantics. Each tool call independent. `isError` flag only. | None | Implicit |
| **Figma** | Manual checkpoints via `commitUndo()`. All plugin actions auto-grouped as one undo step. | Per-checkpoint | Manual |
| **Webflow/Canva** | Discrete tool operations. No cross-tool transactions. | None | Per-tool |
| **Community** | Saga pattern + explicit checkpoint/undo tools | Manual | Per-step |

**Key insight:** No MCP server uses automatic multi-tool transactions. The community pattern is per-tool independence with undo/checkpoint for recovery.

### Concurrency model
MCP SDK dispatches parallel tool calls via `Promise.resolve().then(handler)` — they execute **sequentially** in Node.js's microtask queue (no interleaving). In batch mode, `saveOrAccumulate` is synchronous. The problem is purely about error handler blast radius, not race conditions.

## Architecture Decision: Implicit Micro-Batch

| Architecture | Atomicity | Isolation | Ceremony | Rev Count | Complexity |
|---|---|---|---|---|---|
| Status quo (explicit batch) | Full batch | None | High | 1/batch | Low |
| Per-call auto-commit | Per-call | Full | None | N/N calls | Low |
| **Implicit micro-batch** | **Per-burst** | **Per-call** | **None** | **~1/burst** | Medium |

The micro-batch preserves revision efficiency (1 save per burst of parallel calls) while providing per-call error isolation. Zero ceremony for the LLM. Explicit batches preserved as opt-in for power users who need strict all-or-nothing atomicity.

## Acceptance Criteria

- [ ] New `micro-batch.ts` module with per-call change isolation and coalescing flush
- [ ] `saveOrAccumulate()` routes through micro-batch when no explicit batch is active
- [ ] `handleMutationError()` calls `failCall(callId)` (not `cancelBatchWithRollback`) for micro-batch errors
- [ ] Each mutation tool handler generates a `callId` and registers with micro-batch
- [ ] Failed parallel calls do NOT affect successful sibling calls
- [ ] Successful parallel calls are merged into 1 HTTP save with 1 revision
- [ ] Each successful call gets its own undo stack entry (fine-grained undo)
- [ ] Single-call optimization: no coalescing delay when only 1 call in burst
- [ ] Explicit `begin-batch`/`end-batch` still works (micro-batch dormant when explicit batch active)
- [ ] Unit tests: single call, parallel commits, partial failure, all fail, timer flush, single-call optimization, explicit batch precedence
- [ ] Integration tests: simulate parallel tool handlers, verify error isolation, verify undo granularity

## Happy Path

1. LLM makes 5 parallel style update calls (no begin-batch needed)
2. First call creates a micro-batch automatically
3. Calls 1-4 succeed — each commits changes to micro-batch
4. Call 5 fails (invalid node ref) — only its changes rolled back, marked as failed
5. `pendingCount` reaches 0 → `flush()` merges calls 1-4 → 1 HTTP save → 4 undo entries
6. Call 5 returns `isError: true`. Calls 1-4 return success with same revision number.

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| All parallel calls succeed | 1 save, N undo entries |
| One parallel call fails | Failed call returns error; others succeed in 1 save |
| All parallel calls fail | No save, no undo entries, model clean |
| Single call (no parallelism) | Immediate save, no coalescing delay |
| Explicit batch active | Micro-batch dormant; existing batch behavior unchanged |
| HTTP save fails during flush | All committed entries rolled back; all promises rejected; model clean |
| Server conflict (412) during flush | Rebase + retry via existing SaveManager conflict handling |
| WebSocket update during flush | Update queue already pauses during saves; same mechanism applies |
| withRecording() throws mid-mutation | ChangeRecorder auto-reverts model; `failCall()` marks entry failed |

## Implementation

### New file: `src/micro-batch.ts` (~150 lines)

Peer module to `batch-manager.ts` following same patterns (module-level singleton, RecordedChanges accumulation).

```typescript
interface MicroBatchEntry {
  callId: string;
  changes: RecordedChanges;
  modifiedComponentIids: string[];
  description: string;
  status: 'committed' | 'failed';
}

interface MicroBatchState {
  id: string;
  entries: MicroBatchEntry[];
  pendingCount: number;
  resolvers: Map<string, { resolve: Function; reject: Function }>;
  timer: NodeJS.Timeout | null;
}
```

**Exported functions:**
- `registerCall(callId)` — creates micro-batch on first call; starts 50ms coalescing timer
- `commitCall(callId, changes, description, componentIids): Promise<SaveResult>` — records successful changes; returns promise resolved when batch saves
- `failCall(callId)` — marks call failed (changes already rolled back); decrements pending count
- `flush(apiClient)` — merges committed entries via `mergeRecordedChanges()`, single HTTP save, pushes individual undo operations, resolves promises
- `isMicroBatchActive(): boolean`
- `isCallSettled(callId): boolean`

**Flush trigger:** `pendingCount === 0` OR timer fires (whichever first).
**Single-call optimization:** If only 1 committed entry and `pendingCount === 0`, skip timer — save immediately.
**Explicit batch precedence:** Micro-batch dormant when `isBatchActive()` is true.

### Modified: `src/edit-tools.ts` — `saveOrAccumulate()` (~15 lines)

Add micro-batch routing between explicit batch check and immediate save:

```typescript
if (isBatchActive()) {
  accumulateChanges(changes, modifiedComponentIids);  // unchanged
  return { revisionNum: session.revisionNum, incremental: true };
}

if (isMicroBatchActive()) {
  return commitCall(callId, changes, description, modifiedComponentIids);
}

// immediate save path unchanged
```

Add optional `callId` parameter to `saveOrAccumulate()` signature. The 74 call sites pass it through from the tool handler.

### Modified: `src/server.ts` — `handleMutationError()` + tool handlers (~30 lines)

Each of the 6 mutation tool handler blocks gets `callId` generation:
```typescript
const callId = randomUUID();
registerCall(callId);
try {
  // existing handler logic, pass callId through
} catch (err) {
  return handleMutationError(`node.${action}`, err, callId);
} finally {
  if (!isCallSettled(callId)) failCall(callId);
}
```

`handleMutationError()` extended:
```typescript
if (isBatchActive()) {
  cancelBatchWithRollback();  // unchanged
} else if (callId && isMicroBatchActive()) {
  failCall(callId);
  message += " This operation failed. Other parallel operations are unaffected.";
}
```

### New file: `src/__tests__/micro-batch.test.ts` (~300 lines)

- Single call: register → commit → flush → 1 save, 1 undo entry
- 3 parallel commits: → 1 save, 3 undo entries
- 2 commits + 1 fail: → 1 save with committed changes only, 2 undo entries
- All fail: → no save, no undo, model clean
- Timer-based flush: coalescing window triggers correctly
- Single-call optimization: no timer delay for solo calls
- Explicit batch precedence: micro-batch dormant

### Modified: `src/__tests__/cross-module-integration.test.ts`

- Simulate 3 parallel tool handlers (sequential dispatch matching MCP SDK)
- Call B fails → verify A and C succeed
- Verify undo after micro-batch undoes individual operations

## Migration Plan

1. Explicit `begin-batch`/`end-batch` continues to work unchanged (backward compatible)
2. Without explicit batch, micro-batch activates automatically — zero changes needed in LLM prompts
3. Documentation updated: explicit batching marked as "advanced" for strict all-or-nothing atomicity
4. Default behavior (micro-batch) handles the common case correctly without ceremony

## Out of Scope
- Changing the rebase engine or conflict resolution
- Multi-project atomicity
- Distributed transactions
- Removing explicit batch API (kept for backward compatibility)
