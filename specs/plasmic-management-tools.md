# Page & Component Management Tools

## Jobs to Be Done

- As a developer, I want to rename a page or component after creation so I can refine naming without recreating.
- As a developer, I want to update page SEO metadata (title, description, OG image) via Claude Code so I can manage page metadata programmatically.
- As a developer, I want to get a preview URL for a page so I can verify changes in the browser.
- As a developer, I want to delete pages or components I no longer need so I can keep the project clean.

## Architecture

### Current Gaps

| Operation | Current state | Feasibility |
|-----------|---------------|-------------|
| Rename component/page | Set-once at creation. No update tool. | Client-side model mutation via `TplMgr.renameComponent()` + save. |
| Update page path | Set-once at creation. | Client-side: mutate `component.pageMeta.path` + save. |
| Read page metadata | `get-project-meta` only surfaces `path`, not title/description/OG. | Read from `component.pageMeta` fields. |
| Update page metadata | Not exposed. | Client-side: mutate `component.pageMeta.title`, `.description`, `.openGraphImage` + save. |
| Get preview URL | Not exposed. | Construct from host + project ID + page path. No server call needed. |
| Delete component/page | Not possible. Server API has no `deleteComponents` field. | Client-side: `TplMgr.removeComponent()` + save. Risky — has reference guards. |

### Implementation Approach

All operations except delete can be implemented as client-side model mutations followed by `save-manager.saveChanges()` (the same pattern used by `update-text` and `update-styles`). Delete requires the full `TplMgr.removeComponent()` flow which has guards and cleanup logic.

### New Tools

#### `rename-component`

Renames a page or component. Handles name deduplication automatically.

```typescript
// Input
{ componentUuid: string, newName: string, newPath?: string }

// Implementation
const component = resolveComponentByUuid(componentUuid);
const tplMgr = new TplMgr({ site: session.site });
const changes = tracker.withRecording(() => {
  tplMgr.renameComponent(component, newName);
  if (newPath && component.pageMeta) {
    component.pageMeta.path = newPath;
  }
});
await saveManager.saveChanges(changes);
```

#### `update-page-meta`

Sets page-level SEO metadata.

```typescript
// Input
{
  componentUuid: string,
  title?: string,
  description?: string,
  openGraphImage?: string,  // URL
  canonical?: string,       // canonical URL
  path?: string            // update the page URL path
}

// Implementation
const component = resolveComponentByUuid(componentUuid);
if (!component.pageMeta) throw new Error("Component is not a page");
const changes = tracker.withRecording(() => {
  if (title !== undefined) component.pageMeta.title = new RawText({ text: title, markers: [] });
  if (description !== undefined) component.pageMeta.description = description;
  if (openGraphImage !== undefined) component.pageMeta.openGraphImage = openGraphImage;
  if (canonical !== undefined) component.pageMeta.canonical = canonical;
  if (path !== undefined) component.pageMeta.path = path;
});
await saveManager.saveChanges(changes);
```

#### `get-page-meta`

Reads page-level metadata including SEO fields.

```typescript
// Input
{ componentUuid: string }

// Output
{
  name: "HomePage",
  path: "/",
  title: "Welcome to My Site",
  description: "A description for SEO",
  openGraphImage: "https://...",
  canonical: "https://...",
  params: { slug: "string" }
}
```

#### `get-preview-url`

Constructs a preview URL for a page or component.

```typescript
// Input
{ componentUuid: string }

// Output
{
  previewUrl: "https://studio.plasmic.app/projects/PROJECT_ID/preview/PAGE_PATH",
  studioUrl: "https://studio.plasmic.app/projects/PROJECT_ID"
}
```

No server call needed — constructed from `session.authConfig.host`, `session.projectId`, and the component's page path or arena UUID.

#### `delete-component` (P2 — lower priority due to complexity)

Deletes a page or component from the project. Has safety guards.

```typescript
// Input
{ componentUuid: string, force?: boolean }

// Implementation
const component = resolveComponentByUuid(componentUuid);
const tplMgr = new TplMgr({ site: session.site });

// Check for references (TplMgr.removeComponent asserts this)
const referencingComps = findReferencingComponents(site, component);
if (referencingComps.length > 0 && !force) {
  throw new Error(`Cannot delete "${component.name}": referenced by ${referencingComps.map(c => c.name).join(", ")}. Use force: true to override.`);
}

const changes = tracker.withRecording(() => {
  tplMgr.removeComponent(component);
});
await saveManager.saveChanges(changes);
```

### Files to Modify

1. **`packages/plasmic-mcp/src/server.ts`** — Register new tools: `rename-component`, `update-page-meta`, `get-page-meta`, `get-preview-url`, `delete-component`
2. **`packages/plasmic-mcp/src/edit-tools.ts`** — Add implementation functions for each new tool
3. **`packages/plasmic-mcp/src/wab.d.ts`** — Add type declarations for `TplMgr.renameComponent`, `PageMeta` fields, `RawText`, `removeComponent`
4. **`packages/plasmic-mcp/src/types.ts`** — Add `PageMetaInfo` output type
5. **`.claude/commands/plasmic.md`** — Add routing for rename, delete, metadata, preview URL requests
6. **`.claude/commands/plasmic-edit.md`** — Document rename, metadata, and delete operations
7. **`.claude/commands/plasmic-inspect.md`** — Document `get-page-meta` and `get-preview-url`

### Files to Create

None.

## Acceptance Criteria

### Must Have

- [x] `rename-component` tool: renames component, deduplicates name, saves
- [x] `rename-component` with `newPath` updates page URL path
- [x] `update-page-meta` tool: sets title, description, OG image, canonical
- [x] `update-page-meta` throws if component is not a page
- [x] `get-page-meta` tool: reads all page metadata fields
- [x] `get-preview-url` tool: returns constructed preview and studio URLs
- [x] Unit tests for each new tool (rename, meta read/write, preview URL)
- [x] Unit test: rename with duplicate name gets auto-deduplicated
- [x] Unit test: update-page-meta on non-page component throws
- [x] Skill files updated with new tool documentation
- [x] All existing tests continue to pass

### Nice to Have

- [x] `delete-component` tool with reference-checking guard
- [x] `delete-component` with `force: true` overrides reference check
- [x] Unit test: delete with references → error listing referencing components
- [x] Unit test: delete with `force: true` succeeds despite references
- [ ] `get-project-meta` enhanced to include page metadata summary

## Happy Path

### Rename
1. Developer: "Rename the homepage to LandingPage"
2. `/plasmic-edit` calls `list-components` to find homepage UUID
3. Calls `rename-component` with `{ componentUuid: "...", newName: "LandingPage" }`
4. Component name updated, project saved

### Page metadata
1. Developer: "Set the homepage title to 'Welcome' and description to 'Our landing page'"
2. `/plasmic-edit` calls `update-page-meta` with title and description
3. Page metadata updated, project saved

### Preview
1. Developer: "Give me the preview URL for the homepage"
2. `/plasmic-inspect` calls `get-preview-url`
3. Returns `https://studio.plasmic.app/projects/abc123/preview/`

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Rename to existing name | `TplMgr.renameComponent` auto-deduplicates (e.g., "Card" → "Card 2") |
| Update metadata on non-page component | Throw: "Component 'Header' is not a page — no page metadata to update" |
| Delete component referenced by others | Throw: "Cannot delete 'Card': referenced by HomePage, AboutPage" (unless force) |
| Get preview URL for non-page component | Return studio URL only (no page preview path) |
| Title contains special characters / HTML | Store as-is in RawText — Plasmic handles escaping |

## Out of Scope

- Bulk rename/delete operations
- Moving components between projects
- Managing project-level settings (not component-level)
- Publishing/deploying to production (separate from preview)
- Managing component permissions or access control
