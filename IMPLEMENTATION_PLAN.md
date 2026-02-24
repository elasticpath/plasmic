# Implementation Plan: Claude Code Skills for Plasmic Studio

## Goal

Create Claude Code skills and workflows that interact with Plasmic Studio programmatically, enabling developers to create pages, inspect projects, and manage components from the Claude Code terminal. This is achieved through an MCP server (`@elasticpath/plasmic-mcp`) that embeds the Plasmic editing engine and exposes it as tool calls, paired with Claude Code skill files that orchestrate those tools into coherent workflows.

## Existing Specs

- `specs/plasmic-mcp-server.md` -- MCP server with embedded editing engine
- `specs/plasmic-esbuild-bundling.md` -- esbuild bundling of platform/wab shared code
- `specs/claude-code-skills.md` -- Claude Code skill/command definitions

## Current State (as of 2026-02-24)

### What exists
- All 3 specs are authored and complete
- Root `node_modules/` installed (Feb 19)
- `platform/wab/node_modules/` installed (Feb 19)
- All source code in `platform/wab/src/wab/shared/` is present
- `.claude/settings.local.json` exists with basic permissions (allow: Bash gh/grep/find/ls, WebSearch)
- PEG parser source files exist: `platform/wab/cssPegParser.pegcoffee`, `platform/wab/modelPegParser.pegcoffee`, `platform/wab/funcTplParser.pegcoffee`, `platform/wab/GridStyleParser.pegjs`
- Model generation script exists: `platform/wab/tools/gen-models.ts` (imports `writeTypescriptClasses` + `writeClassesMetas` from `model-generator.ts`)
- Makefile exists: `platform/wab/Makefile` (compiles PEG parsers via `pegjs` + `pegjs-coffee-plugin`)
- `platform/wab/src/wab/gen/` directory exists with `.gitkeep` + `css-peg-parser.spec.ts` (no generated JS files)
- MobX version `6.13.6` (exact pin) in `platform/wab/package.json`
- esbuild `0.17.18` at root, `^0.18.0` in `platform/wab`
- Root `tsconfig.types.json` exists (module: NodeNext, strict, declaration-only output)
- `packages/host/src/element-types.ts` defines the canonical `PlasmicElement` union type with all element types

### What does NOT exist yet
- `packages/plasmic-mcp/` -- no package scaffold, no code
- Generated PEG parsers: `platform/wab/src/wab/gen/cssPegParser.js`, `modelPegParser.js`, `funcTplParser.js`, `GridStyleParser.js`
- Generated model files: `platform/wab/src/wab/shared/model/classes.ts`, `classes-metas.ts`
- `.claude/mcp.json` -- MCP server config for Claude Code
- `.claude/commands/` -- no skill files
- `packages/plasmic-mcp` entry in root `package.json` workspaces array

### Key findings from codebase analysis

1. **`tagged-unbundle.ts` can be AVOIDED**: It only imports `PkgVersionInfo` type from `SharedApi.ts`. The MCP server can use `FastBundler.unbundle()` directly from `bundler.ts` (which has NO problematic imports), defining the `PkgVersionInfo` type locally. This eliminates the entire SharedApi → stripe → @plasmicapp/data-sources import chain.
2. **`gen-element-repr-v2.ts` is SAFE with caveats**: It does NOT import from `client/canvas/slate`. Its direct imports stay within `shared/`. However, two transitive dependencies have benign issues:
   - `RuleSetHelpers.ts` has `import { CSSProperties } from "react"` (value import of a type — esbuild will tree-shake if unused at runtime, but `react` must still be in externals)
   - `tpls.ts` has `import type { ViewCtx } from "@/wab/client/studio-ctx/view-ctx"` (type-only import — completely erased by esbuild, no runtime impact)
3. **`common.ts`** (2855 lines) imports `{ Key } from "react"` (type used as value import). Also imports `lodash`, `dayjs`, `uuid`, `immutable`, `nanoid`, `classnames`, `short-uuid`. All must be externalized or bundled.
4. **`rich-text-util.ts` IS problematic**: It imports `@/wab/client/components/canvas/slate`. Must ensure nothing in the bundle chain imports it.
5. **`SharedApi.ts` has CRITICAL issues**: Imports `stripe`, `@plasmicapp/data-sources`, and uses `window.origin`/`window.top`. Must be avoided entirely.
6. **`import-mobx.ts` uses conditional `require()`**: `typeof window === "undefined" ? require("mobx/dist/mobx.cjs.development.js") : require("mobx")`. With `platform: "node"`, esbuild evaluates the condition at build time and only keeps the CJS branch. Mark `mobx` as external and let Node resolve at runtime.
7. **API endpoint for create-page is `POST`** (not `PUT`): `POST /api/v1/projects/:projectId` with body `{ newComponents: [...] }`. Auth requires `x-plasmic-api-token` + `x-plasmic-api-user` headers.
8. **`upsertComponent` server handler**: Matches by normalized name, path, or UUID. Throws `BadRequestError` if inserting a duplicate (when `allowUpdate=false`). Uses `elementSchemaToTpl()` to convert PlasmicElement body.
9. **Node version**: `.tool-versions` specifies `nodejs 24.4.0` (asdf). No `.nvmrc`.
10. **PEG parser generation**: Via `platform/wab/Makefile`, NOT `yarn setup:wab`. Correct sequence: `yarn setup:wab` (install deps) → `yarn make` (compile PEG parsers) → `cd platform/wab && npm run gen:models` (generate classes).
11. **PEG parser output path**: `platform/wab/src/wab/gen/` (NOT `platform/wab/gen/`). The Makefile rule is `src/wab/gen/%.js: %.pegcoffee`. Code imports via `@/wab/gen/cssPegParser` which resolves to `src/wab/gen/` (since tsconfig maps `@/*` → `./src/*`).
12. **`GET /api/v1/projects` endpoint CONFIRMED**: Exists in `platform/wab/src/wab/server/AppServer.ts:1528`. Uses `teamApiUserAuth` middleware. Accepts `ProjectsRequest` query parameter (`all` | `byIds` | `byWorkspace`). Returns `{ projects: ApiProject[], perms: ApiPermission[] }`.
13. **CLI has NO `listProjects()` method**: The CLI's `PlasmicApi` class in `packages/cli/src/api.ts` is read/codegen focused. The MCP server must implement `GET /api/v1/projects` from scratch using the same auth header pattern.
14. **CLI auth patterns**: `AuthConfig` type has `{ host, user, token, basicAuthUser?, basicAuthPassword? }`. Headers: `x-plasmic-api-user` + `x-plasmic-api-token`. Optional Basic auth for gated instances. `DEFAULT_HOST` fallback for host.
15. **MCP SDK v1.27.0**: Latest stable. Uses `McpServer` class (from `@modelcontextprotocol/sdk/server/mcp.js`), `StdioServerTransport` (from `.../server/stdio.js`), `server.registerTool()` method. Requires `zod@3` as peer dependency. Must use `console.error()` (never `console.log()` which corrupts stdio JSON-RPC).
16. **`model-util.ts`** imports `@plasmicapp/host` — add to externals.
17. **Root `claude` script**: References `.claude/.mcp.json` (dot prefix) and requires Docker container. For local development, use `.claude/mcp.json` (which Claude Code reads by default).
18. **`bundler.ts` FastBundler constructor**: Takes `(rt = meta, classes = classesModule, looseMode = false)`. Expects `classes.justClasses` export from generated `classes.ts`. Must call `configure({ enforceActions: "never" })` on MobX before unbundling.
19. **`tplToPlasmicElements()` is an MVP with SEVERE limitations**: Per comments at `gen-element-repr-v2.ts:2-18`, it "intentionally starting scrappy" for SDUI use case. Only handles: `TplContainer` → `"box"` (all layout types become generic "box" — loses vbox/hbox/page-section distinction), `TplComponent` → `"component"`, `TplTextBlock` → `"text"` with markers. **Ignores**: HTML tags, layout/styling, images, data bindings. Returns `undefined` for all other node types. The `get-component-tree` tool will return a degraded view of pages.
20. **`elementSchemaToTpl()` (server-side, for create-page) handles ALL element types**: `img`, `button`, `input`, `password`, `textarea`, `vbox`, `hbox`, `box`, `page-section`, `component`, `default-component`, `text`. Located in `code-components/code-components.ts:2703-3039`. **Bidirectional asymmetry**: creating pages uses full element support, reading back gives degraded output.
21. **`FastBundler.unbundle()` returns generic `ObjInst`**, NOT a narrowed `Site`. Must use `ensureInstance(result, Site, ProjectDependency)` then `isKnownSite()` guard to narrow. Both `Site` and guard functions come from generated `classes.ts`. See `bundle-migration-utils.ts` for the canonical pattern.
22. **`justClasses` is a generated const object** in `classes.ts` mapping class names to constructors (e.g., `{ Site, Component, TplNode, ... }`). Generated by `model-generator.ts:279-281`. Required by `Bundler` constructor via `classes.justClasses` and used by `InstUtil` for deserialization lookups.
23. **`PkgVersionInfo` can be defined locally**: The only import from `SharedApi.ts` needed by `tagged-unbundle.ts`. For MVP, dependency package loading can be skipped entirely — call `FastBundler.unbundle(bundle, projectId)` directly without loading deps. Cross-project component references may be unresolved (acceptable for Milestone 1).
24. **Dependency packages not addressed in MVP**: The server-side `unbundleSite()` in `bundle-migration-utils.ts` loads deps from DB via `loadDepPackages()`. For the MCP server, the REST API returns the project bundle only. Skipping deps means cross-project references are unresolved — acceptable limitation.
25. **`element-repr-v2.ts` (wab) type set differs from `element-types.ts` (host)**: Wab version lacks `ButtonElement`, `TextInputElement`, `page-section` in containers. Host version (`packages/host/src/element-types.ts`) is the canonical full-feature type spec used by `elementSchemaToTpl`.
26. **MobX version confirmed `6.13.6`** (exact pin in `platform/wab/package.json:334`). esbuild versions: root `0.17.18`, platform/wab `^0.18.0`. `tsconfig.types.json` exists at root for extending. No `@modelcontextprotocol/sdk` in monorepo yet — new dependency.

---

## Phase 1: Foundation

These items unblock everything else. Nothing can be built or tested until generated files exist and the package scaffold is in place.

- [ ] **Generate PEG parsers and model files**
  - What: Three-step generation sequence:
    1. `yarn setup:wab` — installs platform/wab dependencies (may already be done)
    2. `yarn make` (or `cd platform/wab && make`) — compiles PEG parsers via Makefile. Uses `pegjs ~0.10.0` + `pegjs-coffee-plugin ~0.3.0`.
    3. `cd platform/wab && npm run gen:models` — runs `tools/gen-models.ts` which reads `model-schema.ts` DSL via `modelPegParser` and produces TypeScript class definitions + metadata.
  - Files produced:
    - `platform/wab/src/wab/gen/modelPegParser.js` (from `modelPegParser.pegcoffee`)
    - `platform/wab/src/wab/gen/cssPegParser.js` (from `cssPegParser.pegcoffee`)
    - `platform/wab/src/wab/gen/funcTplParser.js` (from `funcTplParser.pegcoffee`)
    - `platform/wab/src/wab/gen/GridStyleParser.js` (from `GridStyleParser.pegjs`)
    - `platform/wab/src/wab/shared/model/classes.ts` (~10,000+ lines — all model classes)
    - `platform/wab/src/wab/shared/model/classes-metas.ts` (~5,000+ lines — MetaRuntime + modelSchemaHash)
  - Note: `node_modules/` already exists from prior `yarn` run. The PEG parsers MUST be generated before `gen:models` can run (it depends on `modelPegParser.js`).
  - Risk: May require Node.js 24.4.0 (per `.tool-versions`). If `make` fails, check that `pegjs` and `pegjs-coffee-plugin` are installed in `platform/wab/node_modules/.bin/`.
  - Depends on: Nothing (first task)

- [ ] **Create `packages/plasmic-mcp/` package scaffold**
  - What: Create directory with `package.json`, `tsconfig.json`, `build.mjs`, and `src/index.ts` stub
  - Files: `packages/plasmic-mcp/package.json`, `packages/plasmic-mcp/tsconfig.json`, `packages/plasmic-mcp/build.mjs`, `packages/plasmic-mcp/src/index.ts`
  - Key constraints:
    - Pin `mobx` to `6.13.6` (must match `platform/wab`)
    - Use custom esbuild config, NOT root `build.mjs` (which is for SDK packages with ESM/CJS dual output + API Extractor)
    - Add `@modelcontextprotocol/sdk` `^1.27.0` as dependency
    - Add `zod` `^3.25.0` as dependency (peer dep of MCP SDK)
    - Add `lodash` as dependency (used by shared code)
    - Set `engines: { "node": ">=18.0.0" }`
    - Set `"type": "module"` for ESM (MCP SDK uses ESM subpath exports)
  - Depends on: Nothing

- [ ] **Register `packages/plasmic-mcp` in root workspace**
  - What: Add `"packages/plasmic-mcp"` to the `workspaces` array in root `package.json` (currently has 24 packages + 47 plasmicpkgs + plasmicpkgs-dev = 72 entries)
  - Files: Root `package.json`
  - Depends on: Package scaffold

- [x] **Author spec: `specs/claude-code-skills.md`** ✓ COMPLETE
  - File exists with full specification for `/plasmic`, `/plasmic-create-page`, `/plasmic-inspect` skills, PlasmicElement type reference, and common patterns.

---

## Phase 2: esbuild Bundling

The MCP server must bundle code from `platform/wab/src/wab/shared/` into a standalone distributable. This is the hardest technical challenge. Key insight: by avoiding `tagged-unbundle.ts` and using `FastBundler.unbundle()` directly, we dodge the most dangerous import chains.

- [ ] **Implement esbuild build script (`build.mjs`)**
  - What: esbuild configuration that bundles `src/index.ts` with alias resolution and targeted externals
  - Config:
    - Entry: `src/index.ts`
    - Output: `dist/index.cjs` (CJS, platform: node, target: node18)
    - Alias (single prefix catch-all): `@/` → `../../platform/wab/src/`
      - This resolves `@/wab/shared/*`, `@/wab/gen/*`, `@/wab/commons/*`, `@/wab/client/*` (client will be externalized)
    - External packages: `mobx`, `mobx/dist/mobx.cjs.development.js`, `@modelcontextprotocol/sdk`, `zod`, `lodash`
    - External safety net (prevent leaking): `react`, `react-dom`, `stripe`, `@plasmicapp/data-sources`, `@react-awesome-query-builder/*`, `slate`, `@react-aria/*`, `typeorm`, `express`, `socket.io-client`, `@plasmicapp/host`, `dayjs`, `uuid`, `immutable`, `nanoid`, `classnames`, `short-uuid`
    - esbuild plugin to externalize any resolved path containing `/wab/client/` or `/wab/server/` (after alias resolution, before bundling — catches transitive client imports)
    - Enable `metafile: true` for bundle analysis
    - Enable `sourcemap: true`
  - Files: `packages/plasmic-mcp/build.mjs`
  - Depends on: Package scaffold, generated files

- [ ] **Resolve transitive dependency issues**
  - What: Handle problematic imports that leak into the bundle. Strategy:
    - **AVOID `tagged-unbundle.ts`**: Use `FastBundler.unbundle()` directly from `bundler.ts`. Define `PkgVersionInfo` type locally if needed. This eliminates: SharedApi → stripe, SharedApi → data-sources, SharedApi → window APIs.
    - **AVOID `rich-text-util.ts`**: Verify no import path from our entry point reaches it. The esbuild plugin externalizing `/wab/client/` paths is the safety net.
    - **`import-mobx.ts`**: Has conditional `require()` based on `typeof window`. With `platform: "node"` esbuild resolves `typeof window === "undefined"` → `true` at build time. Mark `mobx` and `mobx/dist/mobx.cjs.development.js` as external — Node.js resolves from `node_modules/` at runtime.
    - **`common.ts` → `react`**: Imports `{ Key }` from `react` (type used in value position). esbuild should tree-shake unused value, but `react` must be in externals to prevent bundling attempt.
    - **`RuleSetHelpers.ts` → `react`**: Imports `{ CSSProperties }` from `react` (type used in value position). Same handling — externalize react.
    - **`tpls.ts` → `@/wab/client/`**: Has `import type { ViewCtx }` — completely erased by esbuild (type-only import). No action needed.
    - **`css.ts` → `@/wab/gen/cssPegParser`**: Must exist (generated file). Resolved by alias `@/` → `../../platform/wab/src/`.
    - **`model-util.ts` → `@plasmicapp/host`**: Externalized.
  - Files: `packages/plasmic-mcp/build.mjs` (externals list + plugin)
  - Risk: Additional undiscovered imports may surface. Use metafile to audit after first build. Iterative build-fix cycle expected.
  - Depends on: Build script, generated files

- [ ] **Verify esbuild output works standalone**
  - What: Run `node packages/plasmic-mcp/build.mjs`, then `node packages/plasmic-mcp/dist/index.cjs` to verify no import errors. Check bundle size (target: under 2MB for shared code). Estimated ~570KB unminified, ~200KB minified.
  - Verification steps:
    1. Build succeeds with no errors
    2. `node dist/index.cjs` starts without import/require errors
    3. Metafile analysis shows no server-only or client-only code leaked in
    4. No references to `SharedApi`, `stripe`, `slate`, `@/wab/client/` in output
  - Files: `packages/plasmic-mcp/dist/index.cjs`
  - Risk: Runtime errors from dynamic requires or missing generated code.
  - Depends on: Resolved transitive dependencies

- [ ] **Set up TypeScript configuration**
  - What: `tsconfig.json` with path aliases matching esbuild config so `tsc --noEmit` passes
  - Config:
    ```json
    {
      "compilerOptions": {
        "target": "ES2022",
        "module": "Node16",
        "moduleResolution": "Node16",
        "outDir": "./dist",
        "rootDir": "./src",
        "strict": true,
        "skipLibCheck": true,
        "esModuleInterop": true,
        "baseUrl": ".",
        "paths": {
          "@/wab/shared/*": ["../../platform/wab/src/wab/shared/*"],
          "@/wab/gen/*": ["../../platform/wab/src/wab/gen/*"],
          "@/wab/commons/*": ["../../platform/wab/src/wab/commons/*"],
          "@/wab/client/*": ["../../platform/wab/src/wab/client/*"]
        }
      },
      "include": ["src/**/*.ts"],
      "references": []
    }
    ```
  - Files: `packages/plasmic-mcp/tsconfig.json`
  - Depends on: Package scaffold

---

## Phase 3: MCP Server Core

With the bundle working, build the MCP server skeleton, auth, and the API client.

- [ ] **Implement MCP server entry point and tool registration**
  - What: Set up `@modelcontextprotocol/sdk` v1.27.0 with stdio transport. Use `McpServer` class (from `@modelcontextprotocol/sdk/server/mcp.js`) and `StdioServerTransport` (from `.../server/stdio.js`). Register tools using `server.registerTool(name, { description, inputSchema }, handler)` where `inputSchema` is a flat record of Zod schemas.
  - Critical: Never use `console.log()` — only `console.error()` for logging (stdout is JSON-RPC transport).
  - Files: `packages/plasmic-mcp/src/index.ts`, `packages/plasmic-mcp/src/server.ts`
  - Reference: MCP SDK v1.x docs, `server.registerTool()` API
  - Depends on: esbuild bundling working

- [ ] **Implement auth module**
  - What: Read `PLASMIC_AUTH_HOST`, `PLASMIC_AUTH_USER`, `PLASMIC_AUTH_TOKEN` from env vars. Validate user + token present on startup (host defaults to `https://studio.plasmic.app`). Optional fallback to `.plasmic.auth` JSON file. Support optional `basicAuthUser`/`basicAuthPassword` for gated instances.
  - Files: `packages/plasmic-mcp/src/auth.ts`
  - Reference: `packages/cli/src/utils/auth-utils.ts` — `getEnvAuth()` (reads same env vars, warns on partial), `readAuth()` (parses `.plasmic.auth` JSON with `{ host, user, token }` format, strips trailing slashes)
  - Type: `AuthConfig { host: string; user: string; token: string; basicAuthUser?: string; basicAuthPassword?: string; }`
  - Depends on: Server entry point

- [ ] **Implement Plasmic API client**
  - What: HTTP client for Plasmic REST API. Use native `fetch` (Node 18+).
  - Methods needed:
    - `listProjects(query?)` → `GET /api/v1/projects` with query params `{ query: "all" }` (or `byIds`, `byWorkspace`). Returns `{ projects: ApiProject[], perms: ApiPermission[] }`. Auth: `x-plasmic-api-user`, `x-plasmic-api-token` headers.
    - `getProjectBundle(projectId)` → `GET /api/v1/projects/:projectId` (returns `{ rev: { data: string } }` where `data` is JSON-stringified Bundle)
    - `updateProject(projectId, body)` → `POST /api/v1/projects/:projectId` (body includes `newComponents`, `updateComponents`, `tokens`). Auth: same headers.
  - Error handling: Check for 403 → "Incorrect Plasmic credentials". Surface `response.data.error.message` when present. Separate `studioHost` (API calls) from potential `codegenHost` (future).
  - Files: `packages/plasmic-mcp/src/api-client.ts`
  - Reference: `packages/cli/src/api.ts` — `PlasmicApi` class (`makeHeaders()` pattern, error handling)
  - Depends on: Auth module

- [ ] **Implement model loader (bundle fetch + unbundle)**
  - What: Fetch project bundle via API client, `JSON.parse(response.rev.data)` to get `Bundle`, then `new FastBundler(meta, classes).unbundle(bundle, projectId)` to produce live `Site` model. Store bundler instance and site in session state.
  - Key insight: Use `FastBundler` directly from `bundler.ts`, NOT `tagged-unbundle.ts`. This avoids the entire SharedApi import chain.
  - MUST initialize MobX before first unbundle: `import mobx from "@/wab/shared/import-mobx"; mobx.configure({ enforceActions: "never" });`
  - FastBundler constructor needs: `meta` (from `classes-metas.ts`), `classes` module (from `classes.ts` — specifically `classes.justClasses`).
  - **Type narrowing required**: `FastBundler.unbundle()` returns generic `ObjInst`. Must narrow: `const siteOrDep = ensureInstance(result, Site, ProjectDependency); const site = isKnownSite(siteOrDep) ? siteOrDep : siteOrDep.site;` (pattern from `bundle-migration-utils.ts`).
  - **Dependency loading skipped for MVP**: Unlike server-side `unbundleSite()` which loads deps from DB, the MCP server unbundles without deps. Cross-project component references will be unresolved.
  - Files: `packages/plasmic-mcp/src/model-loader.ts`
  - Depends on: API client, esbuild bundling verified

- [ ] **Implement session state management**
  - What: Singleton session holding: active project ID, live `Site` model, `FastBundler` instance. Cleared when `set-project` is called with a different project.
  - Files: `packages/plasmic-mcp/src/session.ts`
  - Depends on: Model loader

- [ ] **Implement tree reader (tplToPlasmicElements wrapper)**
  - What: Wrapper around `tplToPlasmicElements()` from `platform/wab/src/wab/shared/element-repr/gen-element-repr-v2.ts`. Takes a component UUID, finds it in the live model, converts its `tplTree` to `PlasmicElement` JSON.
  - Confirmed safe: `gen-element-repr-v2.ts` dependency chain stays within `shared/` (type-only client imports are erased, react imports are externalized).
  - **Known limitation**: `tplToPlasmicElements()` is an MVP that only handles `TplContainer` → `"box"`, `TplComponent`, and `TplTextBlock`. Ignores HTML tags, layout types (vbox/hbox/page-section all become "box"), styling, and images. The `get-component-tree` output will be a simplified view. Future work: enhance the function to preserve layout types and styling (see Finding #19).
  - Files: `packages/plasmic-mcp/src/tree-reader.ts`
  - Depends on: Session state

---

## Phase 4: MCP Tools

Implement each tool handler. `set-project` must work before any model-reading tool.

- [ ] **Tool: `set-project`**
  - What: Accept `projectId` (string). Call model loader to fetch bundle + unbundle. Store in session. Return project name, component count, page count.
  - Files: `packages/plasmic-mcp/src/tools/set-project.ts`
  - Depends on: Model loader, session state

- [ ] **Tool: `list-projects`**
  - What: `GET /api/v1/projects?query=all`. Return `[{ id, name }]` from `response.projects`. No active project required.
  - Note: Server-side handler accepts `ProjectsRequest` ADT with `query` discriminant (`all` | `byIds` | `byWorkspace`). Uses `teamApiUserAuth` middleware.
  - Files: `packages/plasmic-mcp/src/tools/list-projects.ts`
  - Depends on: API client

- [ ] **Tool: `get-project-meta`**
  - What: Read from in-memory model: project name, component count, page count, design tokens, global variant groups. Requires active project.
  - Files: `packages/plasmic-mcp/src/tools/get-project-meta.ts`
  - Depends on: Session state

- [ ] **Tool: `list-components`**
  - What: Read `site.components` from model. Return `[{ uuid, name, type, path? }]`. Requires active project.
  - Files: `packages/plasmic-mcp/src/tools/list-components.ts`
  - Depends on: Session state

- [ ] **Tool: `get-component-tree`**
  - What: Accept `componentUuid`. Find in model, call tree reader for `PlasmicElement` JSON. Requires active project.
  - **Caveat**: Output is degraded due to `tplToPlasmicElements()` MVP limitations (see Finding #19). All containers appear as `"box"`, styling/images omitted. Still useful for understanding component hierarchy and text content, but does not round-trip perfectly with `create-page` input format.
  - Files: `packages/plasmic-mcp/src/tools/get-component-tree.ts`
  - Depends on: Tree reader

- [ ] **Tool: `create-page`**
  - What: Accept `name`, `path`, `body` (PlasmicElement JSON). `POST /api/v1/projects/:projectId` with `{ newComponents: [{ name, path, body }] }`.
  - Server-side behavior: `upsertComponent()` handler matches by normalized name/path/UUID. Throws `BadRequestError` on duplicate (when `allowUpdate=false`). Uses `elementSchemaToTpl()` to convert PlasmicElement.
  - Files: `packages/plasmic-mcp/src/tools/create-page.ts`
  - Depends on: API client, session state

- [ ] **Model reload after create-page** (nice-to-have)
  - What: Re-fetch bundle and re-unbundle after `create-page` succeeds so the new page appears in the in-memory model.
  - Depends on: `create-page`, model loader

---

## Phase 5: Claude Code Integration

Wire the MCP server into Claude Code and create skill files.

- [ ] **Create `.claude/mcp.json`**
  - What: MCP config for local development. Points to `tsx packages/plasmic-mcp/src/index.ts` with env var references for auth.
  - Note: Root `package.json` has a `claude` script that references `.claude/.mcp.json` (dot prefix) and requires Docker. For local development outside Docker, use `.claude/mcp.json` (standard Claude Code path). Both can coexist.
  - Config:
    ```json
    {
      "mcpServers": {
        "plasmic": {
          "command": "tsx",
          "args": ["packages/plasmic-mcp/src/index.ts"],
          "env": {
            "PLASMIC_AUTH_HOST": "${PLASMIC_AUTH_HOST}",
            "PLASMIC_AUTH_USER": "${PLASMIC_AUTH_USER}",
            "PLASMIC_AUTH_TOKEN": "${PLASMIC_AUTH_TOKEN}"
          }
        }
      }
    }
    ```
  - Files: `.claude/mcp.json`
  - Risk: Auth credentials must not be committed. Env vars are interpolated at runtime.
  - Depends on: MCP server working

- [ ] **Create skill: `/plasmic-create-page`**
  - What: `.claude/commands/plasmic-create-page.md`. Guides Claude through: set-project if needed, list-components, build PlasmicElement tree, call create-page, verify result.
  - Must include: PlasmicElement type reference, common patterns, CSS property format (camelCase), valid element types (`vbox`, `hbox`, `box`, `page-section`, `text`, `img`, `button`, `input`, `password`, `textarea`, `component`, `default-component`), valid HTML tags.
  - Files: `.claude/commands/plasmic-create-page.md`
  - Depends on: MCP tools working

- [ ] **Create skill: `/plasmic-inspect`**
  - What: `.claude/commands/plasmic-inspect.md`. Read-only exploration: set-project, get-project-meta, list-components, optionally get-component-tree.
  - Files: `.claude/commands/plasmic-inspect.md`
  - Depends on: MCP tools working

- [ ] **Create workflow: `/plasmic`**
  - What: `.claude/commands/plasmic.md`. Top-level router skill. Routes natural language to appropriate sub-workflows. Handles project selection, intent routing, and summarization.
  - Files: `.claude/commands/plasmic.md`
  - Depends on: Sub-skills created

---

## Phase 6: Testing and Validation

- [ ] **Unit tests for API client**
  - Files: `packages/plasmic-mcp/src/__tests__/api-client.test.ts`
  - Depends on: API client

- [ ] **Unit tests for model loader**
  - Requires a real bundle fixture from a test Plasmic project.
  - Files: `packages/plasmic-mcp/src/__tests__/model-loader.test.ts`, `packages/plasmic-mcp/src/__tests__/fixtures/`
  - Depends on: Model loader

- [ ] **Integration test: MCP server round-trip**
  - Full flow: `set-project` → `list-components` → `get-component-tree`.
  - Files: `packages/plasmic-mcp/src/__tests__/integration.test.ts`
  - Depends on: All tools

- [ ] **Manual end-to-end test with Claude Code**
  - Requires self-hosted Plasmic instance with valid credentials.
  - Depends on: All phases complete

---

## Phase 7: Nice-to-Haves

- [ ] **Tool: `get-tokens`** — Design tokens from in-memory model
- [ ] **PlasmicElement pattern library** — `.claude/commands/plasmic-patterns.md`
- [ ] **Bundle size optimization** — Metafile analysis, targeted externals
- [ ] **CI pipeline** — `.github/workflows/plasmic-mcp.yml`
- [ ] **npx publishing** — `@elasticpath/plasmic-mcp` npm package with `bin` field

---

## Dependency Graph Summary

```
Phase 1: Foundation
  Generate PEG parsers (yarn make) ──────┐
  Generate model files (gen:models) ─────┤ (depends on PEG parsers)
  Package scaffold ─────────┬────────────┤
  Register workspace ───────┘            │
  Author skills spec ✓ DONE              │
                                         │
Phase 2: esbuild Bundling                │
  Build script (aliases + externals) ────┤
  Resolve transitive deps ───────────────┤
  Verify standalone output ──────────────┤
  TypeScript config                      │
                                         │
Phase 3: MCP Server Core                 │
  Server entry + tool registration ──────┤
  Auth module ───────────────────────────┤
  API client ────────────────────────────┤
  Model loader (FastBundler directly) ───┤
  Session state ─────────────────────────┤
  Tree reader (gen-element-repr-v2) ─────┘
                                         │
Phase 4: MCP Tools                       │
  set-project ───────────────────────────┤
  list-projects                          │
  get-project-meta ──────────────────────┤
  list-components ───────────────────────┤
  get-component-tree ────────────────────┤
  create-page ───────────────────────────┘
                                         │
Phase 5: Claude Code Integration         │
  .claude/mcp.json ──────────────────────┤
  /plasmic-create-page skill ────────────┤
  /plasmic-inspect skill ────────────────┤
  /plasmic skill (router) ───────────────┘
```

## Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PEG parser generation fails (`make`) | Blocks model gen → blocks all esbuild work | Verify `pegjs` + `pegjs-coffee-plugin` in `platform/wab/node_modules/.bin/`. Run `yarn setup:wab` first if missing. |
| Generated model files missing / gen chain broken | Blocks all esbuild work | Three-step sequence: `yarn setup:wab` → `yarn make` → `cd platform/wab && npm run gen:models`; verify each step's output |
| Client-only imports leak into bundle | Runtime crashes in Node.js | esbuild plugin to externalize resolved paths containing `/wab/client/` or `/wab/server/`; avoid `tagged-unbundle.ts` and `SharedApi.ts`; iterative build-fix with metafile |
| `common.ts` and `RuleSetHelpers.ts` import `react` (value imports of types) | Bundle tries to include React or fails | Externalize `react` + `react-dom`; esbuild tree-shakes unused value bindings |
| `import-mobx.ts` conditional require() confuses esbuild | Wrong mobx entry loaded | Externalize `mobx` and `mobx/dist/mobx.cjs.development.js`; Node resolves at runtime |
| Plasmic API endpoint differences in self-hosted | API calls fail | Test against actual self-hosted instance early; reference `packages/cli/src/api.ts` patterns |
| MobX initialization issues in bundled context | Model classes throw at runtime | Call `mobx.configure({ enforceActions: "never" })` before unbundling; test in isolation first |
| PlasmicElement trees Claude generates are invalid | `create-page` fails | Include validated patterns in skill prompts; surface `BadRequestError` messages from `upsertComponent` |
| Large project bundles exceed memory | `set-project` OOMs | Report bundle size; document `--max-old-space-size` flag |
| `console.log()` used in MCP server | Corrupts stdio JSON-RPC transport | Only use `console.error()` for logging; lint rule to ban `console.log` |
| MCP SDK `zod` version mismatch | SDK fails with `_parse is not a function` | Pin `zod@^3.25.0` (not v4); test import at build time |
| `GET /api/v1/projects` requires specific query format | list-projects returns empty | Use `{ query: "all" }` query parameter (confirmed `ProjectsRequest` ADT) |
| `tplToPlasmicElements()` returns degraded trees (MVP only) | `get-component-tree` shows limited view: no layout types, styling, or images | Document limitation in tool output; future work to enhance `gen-element-repr-v2.ts`. For Milestone 1, the read path is secondary to the create path. |
| `FastBundler.unbundle()` returns generic `ObjInst` | Type errors if not narrowed properly | Use `ensureInstance(result, Site, ProjectDependency)` + `isKnownSite()` guard pattern from `bundle-migration-utils.ts` |
| Cross-project component references unresolved | Components from other projects show as broken refs | MVP limitation — skip dependency loading. Document that `set-project` loads single project only. |
| `element-repr-v2.ts` type definitions differ from `element-types.ts` | Type mismatch between read and write paths | Use `packages/host/src/element-types.ts` types for create-page; accept degraded `gen-element-repr-v2.ts` output for reads |

## Spec Corrections

The following corrections were identified during deep code analysis:

1. **PEG parser output path**: Correct location is `platform/wab/src/wab/gen/` (NOT `platform/wab/gen/`). The Makefile rule is `src/wab/gen/%.js: %.pegcoffee`. The `@/wab/gen/` import path resolves to `src/wab/gen/` via tsconfig `@/*` → `./src/*` mapping.
2. **PEG parser generation command**: Use `yarn make` (runs `cd platform/wab && make`), NOT `yarn setup:wab`. The `setup:wab` script only runs `cd platform/wab && yarn` (dependency install). The Makefile compiles PEG parsers.
3. **Path to `gen-element-repr-v2.ts`**: Actual location is `platform/wab/src/wab/shared/element-repr/gen-element-repr-v2.ts`, not `codegen/gen-element-repr-v2.ts`.
4. **`gen-element-repr-v2.ts` transitive deps have benign react imports**: `RuleSetHelpers.ts` imports `CSSProperties` from `react` (value import of a type), `tpls.ts` has `import type { ViewCtx }` from `@/wab/client/` (erased by esbuild). Both handled by externalizing `react` and the client-path plugin.
5. **`common.ts` imports react**: `import { Key } from "react"` — must externalize react.
6. **`tplToPlasmicElements()` is safe to bundle**: With the above externals in place, the full import chain works in Node.js.
7. **`create-page` uses `POST`** not `PUT`: Component creation goes through `POST /api/v1/projects/:projectId`.
8. **`tagged-unbundle.ts` only needs a type from `SharedApi.ts`**: Specifically `PkgVersionInfo`. Bypass entirely by using `FastBundler.unbundle()` directly.
9. **`list-projects` endpoint confirmed**: `GET /api/v1/projects` exists at `AppServer.ts:1528`. Uses `teamApiUserAuth` middleware. Accepts `ProjectsRequest` ADT query parameter.
10. **CLI has no `listProjects()` method**: MCP server must implement this from scratch. The CLI's `PlasmicApi` is codegen-focused.
11. **MCP SDK API**: Use `McpServer` class with `server.registerTool()` (not `Server` + `setRequestHandler`). Input schemas use flat Zod records, not JSON Schema.
12. **Additional externals discovered**: `dayjs`, `uuid`, `immutable`, `nanoid`, `classnames`, `short-uuid` (from `common.ts`), `@plasmicapp/host` (from `model-util.ts`).
13. **`tplToPlasmicElements()` functional limitation**: The spec describes `get-component-tree` as returning full `PlasmicElement` JSON, but the underlying function is an SDUI MVP. It flattens all container layout types to `"box"` and omits styling/images. The write path (`elementSchemaToTpl`) is complete. This bidirectional asymmetry is by design per comments in `gen-element-repr-v2.ts:2-18`.
14. **`FastBundler.unbundle()` return type is generic**: Returns `ObjInst` (union of all model classes). The model-loader must use `ensureInstance(result, Site, ProjectDependency)` + `isKnownSite()` to narrow to `Site`. Both are exports from generated `classes.ts`.
15. **`element-repr-v2.ts` (wab) vs `element-types.ts` (host)**: The wab version defines a subset of element types (no `ButtonElement`, no `TextInputElement`, no `page-section` container). The host version is canonical. The MCP server's `create-page` sends elements to the server-side `elementSchemaToTpl` which supports the full host type set.
16. **`genReprV3` exists in `loader.ts`**: Server-side only (requires DB access via `superDbMgr`). Not usable by the MCP server. No standalone v3 element repr module exists.
