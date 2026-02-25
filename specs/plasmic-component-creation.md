# Component Creation and Cloning MCP Tools

## Jobs to Be Done

- As a developer using Claude Code, I want to create a reusable Plasmic component (not a page) from a PlasmicElement tree, so that I can build shared UI primitives (cards, buttons, hero sections, etc.) without opening Plasmic Studio.
- As a developer using Claude Code, I want to clone an existing component or page into a new component, so that I can quickly create variants or copies without starting from scratch.
- As a developer, I want both operations to automatically reload the in-memory model after creation, so that subsequent `list-components` and `get-component-tree` calls reflect the new component without needing a manual `set-project`.

## Architecture

### How `create-component` Differs from `create-page`

`create-page` and `create-component` both call `apiClient.updateProject(projectId, { newComponents: [...] })` but differ in one field:

| Field   | `create-page`                        | `create-component`              |
|---------|--------------------------------------|---------------------------------|
| `name`  | PascalCase page name                 | PascalCase component name       |
| `path`  | Required (`"/products"`)             | **Absent** — absence signals `ComponentType.Plain` to the server |
| `body`  | Required PlasmicElement tree         | Required PlasmicElement tree    |

On the server side (`platform/wab/src/wab/server/routes/projects.ts`), a `NewComponentReq` entry without `path` is treated as a plain (reusable) component rather than a page. No additional fields are needed.

### How `clone-component` Works

Cloning uses the `cloneFrom` field in `NewComponentReq` instead of `body`:

```typescript
await apiClient.updateProject(projectId, {
  newComponents: [{ name: cloneName, cloneFrom: { uuid: sourceUuid } }],
});
```

The server copies the source component's full Tpl tree into the new component. The `body` field is not required when `cloneFrom` is present.

### Type Fixes Required in `types.ts`

Two corrections are needed before implementing:

1. **`cloneFrom` type** — currently typed as `string` in `NewComponentReq`, which is incorrect. The server-side `ApiSchema.ts` accepts `{ uuid: string } | { name: string }`. Change to:

   ```typescript
   cloneFrom?: { uuid: string } | { name: string };
   ```

2. **`body` optionality** — currently typed as `body: PlasmicElement` (required). Cloning does not need a body. Change to:

   ```typescript
   body?: PlasmicElement;
   ```

### Server API Response

`POST /api/v1/projects/:projectId` returns:

```json
{
  "result": {
    "newComponents": [
      { "uuid": "abc-123", "name": "HeroCard", "path": null }
    ]
  }
}
```

The `uuid` can be extracted and returned to the caller so they can immediately use it with `get-component-tree` without calling `list-components` first. Note that `updateProject` in `api-client.ts` is typed as `Promise<unknown>` — the implementation should cast or narrow the response to read `result.newComponents[0].uuid`.

### Model Reload Pattern

After creation or cloning, the in-memory model must be reloaded. The pattern is identical to `create-page` in `server.ts`:

```typescript
disposeChangeTracker();
clearNodeCache();
const { site, bundler, projectName, revisionNum, modelVersion, hostlessDataVersion } =
  await loadProject(apiClient, session.projectId);
setSession({ projectId: session.projectId, projectName, site, bundler,
  revisionNum, modelVersion, hostlessDataVersion, projectUuid: session.projectId });
initChangeTracker(site);
```

Reload errors are non-fatal: log via `console.error` and return a warning in the response rather than failing the whole operation.

### Files to Change

| File | Change |
|------|--------|
| `packages/plasmic-mcp/src/types.ts` | Fix `cloneFrom` type; make `body` optional in `NewComponentReq` |
| `packages/plasmic-mcp/src/server.ts` | Register `create-component` and `clone-component` tools |
| `.claude/commands/plasmic.md` | Add `create-component` and `clone-component` to the tool list and routing rules |
| `.claude/commands/plasmic-create-component.md` | New skill file (mirrors `plasmic-create-page.md` pattern) |

### New Skill: `plasmic-create-component`

A new Claude Code skill at `.claude/commands/plasmic-create-component.md` mirrors `plasmic-create-page.md`. It documents:
- The two tools available (`create-component`, `clone-component`)
- The same PlasmicElement type reference (shared with `create-page`)
- Instructions to check for naming conflicts via `list-components` before creating
- Instructions to call `get-tokens` and use design token values in styles
- Instructions to use `clone-component` when the user describes wanting a copy or variant of an existing component

The `plasmic.md` router must also be updated to route requests like "create a component", "make a reusable card", "clone the hero" to `/plasmic-create-component`.

## Acceptance Criteria

### Must Have

- [x] `NewComponentReq.cloneFrom` in `types.ts` is typed as `{ uuid: string } | { name: string }` (not `string`)
- [x] `NewComponentReq.body` in `types.ts` is optional (`body?: PlasmicElement`)
- [x] `create-component` tool registered in `server.ts` with `name` and `body` parameters (no `path`)
- [x] `create-component` calls `apiClient.updateProject(projectId, { newComponents: [{ name, body }] })`
- [x] `create-component` reloads the model after creation using the same pattern as `create-page`
- [x] `create-component` returns `{ success: true, name, message }` (uuid from server response not yet extracted — `updateProject` returns opaque `unknown`)
- [x] `clone-component` tool registered in `server.ts` with `name` and `sourceUuid` parameters
- [x] `clone-component` calls `apiClient.updateProject(projectId, { newComponents: [{ name, cloneFrom: { uuid: sourceUuid } }] })`
- [x] `clone-component` reloads the model after creation using the same pattern as `create-page`
- [x] `clone-component` returns `{ success: true, name, clonedFrom, clonedFromUuid, message }`
- [x] `.claude/commands/plasmic-create-component.md` skill file exists with PlasmicElement reference and instructions for both `create-component` and `clone-component`
- [x] `.claude/commands/plasmic.md` updated: tool list includes `create-component` and `clone-component`, routing rules include component creation and cloning requests
- [x] All existing tests continue to pass (269 total)
- [x] New unit tests for `create-component` and `clone-component` in `server.test.ts` (3 + 4 = 7 tests)

### Nice to Have

- [ ] `create-component` Zod schema validates that `name` is non-empty
- [ ] `clone-component` Zod schema validates that `sourceUuid` is a non-empty string
- [x] `plasmic-create-component.md` skill includes examples showing when to use `clone-component` vs `create-component` (copy-with-variation vs new-from-scratch)
- [x] `server.test.ts` test: `clone-component` with an unknown `sourceUuid` returns `isError: true`

## Happy Path

### Creating a new component

1. User (via Claude Code) calls `/plasmic-create-component "create a card component with an image, title, and description"`
2. Skill loads `plasmic-create-component.md`
3. Skill calls `list-components` to check for naming conflicts
4. Skill calls `get-tokens` to discover project colors and spacing
5. Skill constructs a PlasmicElement tree for the card using token values
6. Skill calls `create-component({ name: "Card", body: { ... } })`
7. Server handler calls `apiClient.updateProject(projectId, { newComponents: [{ name: "Card", body: { ... } }] })`
8. Server returns `{ result: { newComponents: [{ uuid: "abc-123", name: "Card", path: null }] } }`
9. Handler reloads model: `disposeChangeTracker` → `clearNodeCache` → `loadProject` → `setSession` → `initChangeTracker`
10. Tool returns `{ success: true, name: "Card", uuid: "abc-123", message: "Component \"Card\" created" }`
11. Claude reports the new component UUID so the user can immediately call `get-component-tree`

### Cloning an existing component

1. User calls `/plasmic-create-component "clone the HeroSection component as HeroSectionDark"`
2. Skill calls `list-components` to find `HeroSection` UUID (e.g., `"xyz-456"`)
3. Skill calls `clone-component({ name: "HeroSectionDark", sourceUuid: "xyz-456" })`
4. Server handler calls `apiClient.updateProject(projectId, { newComponents: [{ name: "HeroSectionDark", cloneFrom: { uuid: "xyz-456" } }] })`
5. Server copies the full Tpl tree from `HeroSection` into `HeroSectionDark`
6. Server returns `{ result: { newComponents: [{ uuid: "def-789", name: "HeroSectionDark", path: null }] } }`
7. Handler reloads model (same as above)
8. Tool returns `{ success: true, name: "HeroSectionDark", uuid: "def-789", clonedFrom: "xyz-456", message: "Component \"HeroSectionDark\" cloned from \"xyz-456\"" }`

## Edge Cases

| Scenario | Expected Behaviour |
|----------|--------------------|
| `name` conflicts with an existing component | Server returns an error. Tool returns `isError: true` with the server error message. Caller should call `list-components` first to check for conflicts. |
| `sourceUuid` does not exist (clone) | Server returns an error. Tool returns `isError: true`. Message should hint to use `list-components` to find valid UUIDs. |
| Model reload fails after successful creation | Log warning via `console.error`. Return success response with an additional `reloadWarning` field so the caller knows to call `refresh-project` manually. |
| `body` contains an invalid PlasmicElement type | Server validates the element tree. Returns HTTP 4xx. Tool surfaces the error message verbatim. |
| `create-component` called without an active project (`requireSession` throws) | Returns `isError: true` with "No active project. Call set-project first." |
| Server response does not include `result.newComponents[0].uuid` | Return `uuid: null` in the response. Do not throw. Log a warning. |
| Component name contains spaces or lowercase | Skill should normalise to PascalCase before calling the tool, but the tool itself does not enforce casing — that is the caller's responsibility. |

## Out of Scope

- Creating components with variants, states, or prop definitions (the `body` parameter only supports the base tree structure)
- Updating or replacing an existing component's body via `updateComponents` (separate tool)
- Cross-project cloning (source and destination must be the same project)
- Creating hostless/code components (those are registered via the host app, not the REST API)
- Browser/Playwright tests for the new tools
- Deleting components
