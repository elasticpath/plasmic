# Plasmic MCP Server — Embedded Editing Engine

## Jobs to Be Done
- As a developer or designer using Claude Code, I want an MCP server that loads Plasmic projects into memory so that I can read component trees, understand page structure, and make targeted changes without losing variant settings or responsive styles.
- As a team member, I want to iterate on Plasmic pages from the terminal while others work in Plasmic Studio, so that CLI and visual workflows coexist safely.

## Architecture

### Package
`@elasticpath/plasmic-mcp` at `packages/plasmic-mcp/` in the monorepo. Published as a standalone npm package with the Plasmic editing engine bundled in via esbuild (see `specs/plasmic-esbuild-bundling.md`).

### Core Concept: Headless Studio Client
Unlike a thin REST API wrapper, this MCP server embeds the same editing engine that Plasmic Studio uses. It loads the project's Bundle into a live in-memory model (Site → Components → TplNodes) using the `FastBundler` from `platform/wab/src/wab/shared/bundler.ts`. This means:
- **Reads are instant and lossless** — component trees, tokens, metadata all come from the in-memory Tpl model, read directly from model objects (NOT via the degraded `tplToPlasmicElements()` function)
- **Full fidelity** — the Tpl model contains everything: HTML tags, layout types (vbox/hbox/page-section), all CSS styles, images, variant settings, data bindings
- **Writes (future)** — direct model mutations tracked by MobX, saved via incremental bundling

### Data Flow: How the Model Gets Loaded
The MCP server runs locally (Node.js on the developer's machine). It does NOT need database access. The data flow mirrors exactly what Plasmic Studio does in the browser:

1. MCP server makes HTTP request to self-hosted Plasmic server: `GET /api/v1/projects/:projectId`
2. Plasmic server (which has DB access) serializes the project into a Bundle JSON
3. MCP server receives `response.rev.data` — a JSON string containing the full Bundle
4. `FastBundler.unbundle(bundle)` reconstructs the live Tpl model in Node.js memory
5. All read tools query the in-memory model directly — no further HTTP calls needed

```
Plasmic Server (self-hosted, has DB)     MCP Server (local Node.js, no DB)
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│ Database → Bundle serialization │ ──→ │ HTTP fetch → unbundle() → model  │
│                                 │     │                                  │
│ GET /api/v1/projects/:id        │     │ Live Tpl model in memory:        │
│   → { rev: { data: Bundle } }  │     │   Site → Components → TplNodes   │
└─────────────────────────────────┘     │   (same objects as in Studio)    │
                                        └──────────────────────────────────┘
```

This is the same mechanism Studio uses — Studio is a browser app that fetches the bundle over HTTP and unbundles it client-side. Our MCP server does the same thing, just in Node.js.

### How it connects to Claude Code
```bash
claude mcp add plasmic -- npx @elasticpath/plasmic-mcp
```

Or in `.claude/mcp.json`:
```json
{
  "mcpServers": {
    "plasmic": {
      "command": "npx",
      "args": ["@elasticpath/plasmic-mcp"],
      "env": {
        "PLASMIC_AUTH_HOST": "https://your-plasmic-instance.example.com",
        "PLASMIC_AUTH_USER": "<api-user-id>",
        "PLASMIC_AUTH_TOKEN": "<api-token>"
      }
    }
  }
}
```

During development from the monorepo:
```json
{
  "mcpServers": {
    "plasmic": {
      "command": "tsx",
      "args": ["packages/plasmic-mcp/src/index.ts"],
      "env": {
        "PLASMIC_AUTH_HOST": "https://your-plasmic-instance.example.com",
        "PLASMIC_AUTH_USER": "<api-user-id>",
        "PLASMIC_AUTH_TOKEN": "<api-token>"
      }
    }
  }
}
```

### Upstream Merge Constraint
This monorepo is a fork that regularly pulls from upstream Plasmic. All new functionality must live in new files/packages — never add code inline to existing upstream files. The entire MCP server lives in `packages/plasmic-mcp/` (a new package, zero merge conflict risk). If platform/wab changes are ever needed (future milestones), they must be isolated into new modules that are imported with minimal one-line changes to existing files.

### Self-Hosted Plasmic
Designed for self-hosted Plasmic instances. `PLASMIC_AUTH_HOST` must point to your own deployment — no default fallback to `studio.plasmic.app`.

### Auth
- Via environment variables: `PLASMIC_AUTH_HOST`, `PLASMIC_AUTH_USER`, `PLASMIC_AUTH_TOKEN`
- Same env vars used by `@plasmicapp/cli`
- All API requests include headers: `x-plasmic-api-user` and `x-plasmic-api-token`
- Optional: read from `.plasmic.auth` file as fallback

### Session Context
The MCP server maintains session state:
- **Active project** — set via `set-project`, used as default for all subsequent tool calls
- **Live model** — the unbundled Site object graph for the active project, held in memory
- **Bundler instance** — `FastBundler` that maps between IIDs and live objects

When `set-project` is called:
1. Fetch project bundle via `GET /api/v1/projects/:projectId`
2. `FastBundler.unbundle(bundle)` → live Site model in memory
3. All read tools operate on the in-memory model (no HTTP calls)

## Acceptance Criteria (Milestone 1: Read-Only + Basic Write)

### Must Have
- [x] esbuild bundles `platform/wab/src/wab/shared/` code into standalone package (see `specs/plasmic-esbuild-bundling.md`)
- [x] MCP server starts via stdio and registers tools with Claude Code
- [x] Auth via env vars works
- [x] Tool: `set-project` — fetch project bundle, unbundle into live model, store as session state
- [x] Tool: `list-projects` — list projects the user has access to (HTTP call)
- [x] Tool: `list-components` — list pages/components with metadata from in-memory model
- [x] Tool: `get-component-tree` — read a component's full tree directly from the in-memory Tpl model (tags, styles, layout types, children, images)
- [x] Tool: `get-project-meta` — read project metadata from in-memory model
- [x] Tool: `create-page` — create a page with PlasmicElement tree via REST API (`POST /api/v1/projects/:id` with `newComponents`)
- [x] All errors return clear, actionable messages
- [x] Package can be installed via npm and run via `npx`

### Nice to Have (Milestone 1)
- [x] Tool: `get-tokens` — read design tokens from in-memory model
- [x] Model reload after `create-page` (re-fetch bundle to see new page in model)

## Happy Path
1. Developer adds MCP server to Claude Code config (once)
2. Developer sets env vars pointing to self-hosted Plasmic (once)
3. In Claude Code: "work on project 'My Store'"
4. Claude calls `set-project` → fetches bundle, unbundles into live model
5. Developer: "what pages exist?"
6. Claude calls `list-components` → reads from in-memory model, returns page names/paths/UUIDs instantly
7. Developer: "show me the structure of the homepage"
8. Claude calls `get-component-tree` with homepage UUID → reads directly from in-memory Tpl model, returns full tree with tags, styles, layout types, children
9. Developer: "create a new product page at /products with a hero and grid"
10. Claude builds PlasmicElement tree, calls `create-page` → `POST /api/v1/projects/:id` with `newComponents`
11. API returns UUID of the new page

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Missing env vars | Error on startup: "PLASMIC_AUTH_HOST, PLASMIC_AUTH_USER, and PLASMIC_AUTH_TOKEN required." |
| Invalid/expired token | "Authentication failed. Check your Plasmic API token." |
| `set-project` with invalid ID | "Project not found. Check the project ID." |
| Tool called before `set-project` | "No active project. Use set-project first." |
| Bundle too large for memory | Report size and suggest checking Node.js memory limits |
| `get-component-tree` for unknown UUID | "Component UUID not found in project." |
| TplNode type not recognized by tree reader | Include raw type name in output with a note: "Unknown node type: TplSlot. Showing children only." |
| Network timeout during bundle fetch | "Could not reach Plasmic API at {host}. Check your network." |
| `create-page` path conflict | Surface API warning: "Path /products adjusted to /products-1." |
| Model stale after external edit | Milestone 1: model is a snapshot from `set-project` time. Future: socket.io sync. |

## Out of Scope (Milestone 1)
- Incremental writes via `fastBundle()` (future milestone)
- Socket.io real-time sync with Studio (future milestone)
- MobX change tracking and model mutation (future milestone)
- Variant-aware editing (future milestone)
- Design token management (nice-to-have for M1)
- Code component wiring
- Visual preview/rendering in terminal
- Code generation or export
- Remote/hosted MCP transport

## Future Vision

### Milestone 2: Incremental Writes
- Set up MobX `observeModel()` on the live Site model
- Implement targeted model mutations (add child, update styles, change text)
- Use `fastBundle()` to serialize only changed IIDs
- Save via `POST /projects/:id/revisions` with `incremental: true`
- Reload model is no longer needed — model stays in sync with server

### Milestone 3: Real-Time Collaboration
- Connect via socket.io to receive `update` events
- Fetch deltas via `getModelUpdates()` and merge with `unbundlePartial()`
- MCP server participates in same multiplayer protocol as Studio
- Concurrent editing between CLI and browser is safe

## Technical Notes

### Model Loading Flow
```
GET /api/v1/projects/:projectId
  → response.rev.data (JSON string)
  → JSON.parse() → Bundle { root, map, deps, version }
  → FastBundler.unbundle(bundle, projectId)
  → Live Site object graph:
      Site
        └─ components: Component[]
            └─ tplTree: TplNode (TplTag | TplComponent | TplSlot)
                └─ vsettings: VariantSetting[]
                    └─ rs: RuleSet { values: Map<string, string> }
```

### Reading Component Trees (Direct Tpl Model Access)
The `get-component-tree` tool reads directly from the in-memory Tpl model — it does NOT use the `tplToPlasmicElements()` function (which is a degraded SDUI MVP that drops styles, images, and layout types).

Instead, the tree reader in `packages/plasmic-mcp/src/tree-reader.ts` walks the Tpl tree and extracts:

```
component.tplTree (TplNode)
  → TplTag:
      .tag         → HTML tag ("div", "h1", "nav", "section", etc.)
      .children    → child TplNodes (recursive)
      .type        → "text" | "image" | "column" | "columns" | "other"
      .vsettings[0].rs.values → CSS styles as Map<string, string>
      .vsettings[0].text      → RichText content (for text nodes)
      .vsettings[0].attrs     → HTML attributes
  → TplComponent:
      .component.name → referenced component name
      .component.uuid → referenced component UUID
  → TplSlot:
      .param.variable.name → slot name
      .defaultContents     → default child nodes
```

The tree reader produces a JSON output that includes all the information Claude needs:
- Element type and HTML tag
- CSS styles (from the base variant's RuleSet)
- Text content
- Image sources
- Layout type (derived from flex direction in styles)
- Child hierarchy
- Referenced component names

This is new code in `packages/plasmic-mcp/` — it does not modify any upstream files.

### Writing Pages (Milestone 1 — REST API)
Uses the existing `POST /api/v1/projects/:projectId` endpoint with `UpdateProjectReq`:
```typescript
{
  newComponents: [{
    name: "PageName",
    path: "/page-path",  // presence of path makes it a Page
    body: PlasmicElement  // the component tree
  }]
}
```

### API Endpoints Used
| Tool | Method | Endpoint | Source |
|------|--------|----------|--------|
| set-project | GET | `/api/v1/projects/:projectId` | Bundle fetch |
| list-projects | GET | `/api/v1/projects` | HTTP |
| list-components | — | In-memory model | `site.components` |
| get-component-tree | — | In-memory model | Direct Tpl traversal |
| get-project-meta | — | In-memory model | `site` properties |
| create-page | POST | `/api/v1/projects/:projectId` | REST API |

### Key Dependencies
- `@modelcontextprotocol/sdk` — MCP protocol (stdio transport)
- `mobx` — Required by the model classes and bundler
- Bundled from `platform/wab/src/wab/shared/`:
  - `bundler.ts` (FastBundler)
  - `model/classes.ts` (Site, Component, TplTag, TplNode, VariantSetting, RuleSet, etc.)
  - `model/classes-metas.ts` (model metadata)

### Reference Files
- `platform/wab/src/wab/shared/bundler.ts` — FastBundler, Bundle format
- `platform/wab/src/wab/shared/model/classes.ts` — generated model classes
- `platform/wab/src/wab/shared/model/model-schema.ts` — schema (source of truth)
- `platform/wab/src/wab/shared/ApiSchema.ts` — API request/response types
- `platform/wab/src/wab/server/routes/projects.ts` — server handlers
- `packages/cli/src/api.ts` — reference HTTP client (auth headers, error handling)
- `packages/cli/src/utils/auth-utils.ts` — env var auth pattern
- `packages/host/src/element-types.ts` — PlasmicElement type definitions

### Package Structure
```
packages/plasmic-mcp/
├── package.json
├── tsconfig.json
├── build.mjs                    # esbuild config (see plasmic-esbuild-bundling.md)
├── src/
│   ├── index.ts                 # Entry point — starts MCP server
│   ├── server.ts                # MCP server setup, tool registration
│   ├── api-client.ts            # Plasmic HTTP client (auth, fetch bundle, REST writes)
│   ├── model-loader.ts          # Bundle fetch → FastBundler.unbundle() → live model
│   ├── tree-reader.ts           # Direct Tpl model → JSON traversal (new code, not upstream)
│   ├── tools/
│   │   ├── set-project.ts       # Load model, store session state
│   │   ├── list-projects.ts     # HTTP: list accessible projects
│   │   ├── list-components.ts   # In-memory: list pages/components
│   │   ├── get-component-tree.ts # In-memory: read PlasmicElement tree
│   │   ├── get-project-meta.ts  # In-memory: project metadata
│   │   └── create-page.ts       # HTTP: POST newComponents
│   └── types.ts                 # API types (from ApiSchema.ts)
└── README.md
```
