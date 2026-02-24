# Implementation Plan: Claude Code Skills for Plasmic Studio

## Goal

Create Claude Code skills and workflows that interact with Plasmic Studio programmatically, enabling developers to create pages, inspect projects, and manage components from the Claude Code terminal. This is achieved through an MCP server (`@elasticpath/plasmic-mcp`) that embeds the Plasmic editing engine and exposes it as tool calls, paired with Claude Code skill files that orchestrate those tools into coherent workflows.

## Existing Specs

- `specs/plasmic-mcp-server.md` -- MCP server with embedded editing engine
- `specs/plasmic-esbuild-bundling.md` -- esbuild bundling of platform/wab shared code
- `specs/claude-code-skills.md` -- Claude Code skill/command definitions

## Current State (as of 2026-02-24, updated with get-tokens tool)

### What exists
- All 3 specs are authored and complete
- Root `node_modules/` installed (Feb 19)
- `platform/wab/node_modules/` installed (Feb 19)
- All source code in `platform/wab/src/wab/shared/` is present
- `.claude/settings.local.json` exists with basic permissions (allow: Bash gh/grep/find/ls, WebSearch)
- PEG parsers ALREADY generated: all 4 `.js` files in `platform/wab/src/wab/gen/`
- Model files ALREADY generated: `classes.ts` (7,767 lines), `classes-metas.ts` (6,724 lines)
- MobX version `6.13.6` (exact pin) in `platform/wab/package.json`
- esbuild `0.17.18` at root, `^0.18.0` in `platform/wab`
- Root `tsconfig.types.json` exists (module: NodeNext, strict, declaration-only output)
- `packages/host/src/element-types.ts` defines the canonical `PlasmicElement` union type with all element types

### What has been implemented (Phases 1–5)
- `packages/plasmic-mcp/` — full package with scaffold, build, and all source files
- `packages/plasmic-mcp/package.json` — dependencies matching wab versions, bin entry
- `packages/plasmic-mcp/tsconfig.json` — TypeScript config with `@/` path aliases and wab module declarations
- `packages/plasmic-mcp/build.mjs` — esbuild config with 5-layer plugin (alias resolution, client/server externalization, malformed import handling, stub modules for optional packages, npm externalization)
- `packages/plasmic-mcp/src/index.ts` — MCP server entry point (stdio transport)
- `packages/plasmic-mcp/src/server.ts` — McpServer with 7 tools: set-project, list-projects, get-project-meta, list-components, get-component-tree, get-tokens, create-page
- `packages/plasmic-mcp/src/auth.ts` — Auth module (env vars + .plasmic.auth fallback)
- `packages/plasmic-mcp/src/api-client.ts` — HTTP client (native fetch, listProjects/getProjectBundle/updateProject)
- `packages/plasmic-mcp/src/model-loader.ts` — Bundle fetch + FastBundler.unbundle() with MobX init
- `packages/plasmic-mcp/src/session.ts` — Singleton session state
- `packages/plasmic-mcp/src/tree-reader.ts` — Custom Tpl model walker (TplTag/TplComponent/TplSlot with full CSS/text/attrs)
- `packages/plasmic-mcp/src/token-reader.ts` — Design token reader with token reference resolution
- `packages/plasmic-mcp/src/types.ts` — AuthConfig, API types, TokenInfo, TreeNode types
- `packages/plasmic-mcp/src/wab.d.ts` — TypeScript declarations for bundled @/wab modules
- `packages/plasmic-mcp` registered in root workspace
- `.claude/mcp.json` — MCP server config for Claude Code
- `.claude/commands/plasmic.md` — Top-level router skill
- `.claude/commands/plasmic-create-page.md` — Page creation skill with PlasmicElement reference
- `.claude/commands/plasmic-inspect.md` — Project inspection skill

### Build status
- Bundle: 1313 KB CJS, 54 external npm packages
- TypeScript: `tsc --noEmit` passes with zero errors
- Runtime: Module loads and starts successfully, authenticates from .plasmic.auth
- Tests: 81 tests, 7 suites, all passing (`npm test` in `packages/plasmic-mcp/`)

### What remains
- Phase 6: Manual end-to-end test with Claude Code (requires self-hosted Plasmic instance)
- Phase 7: Nice-to-haves (pattern library, CI pipeline, npm publishing)

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
15. **MCP SDK**: Uses `McpServer` class (from `@modelcontextprotocol/sdk/server/mcp.js`), `StdioServerTransport` (from `.../server/stdio.js`), `server.registerTool()` method. Supports `zod@^3.25.0` or `zod@4` as peer dependency. Must use `console.error()` (never `console.log()` which corrupts stdio JSON-RPC).
16. **`model-util.ts`** imports `@plasmicapp/host` — add to externals.
17. **Root `claude` script**: References `.claude/.mcp.json` (dot prefix) and requires Docker container. For local development, use `.claude/mcp.json` (which Claude Code reads by default).
18. **`bundler.ts` FastBundler constructor**: Takes `(rt = meta, classes = classesModule, looseMode = false)`. Expects `classes.justClasses` export from generated `classes.ts`. Must call `configure({ enforceActions: "never" })` on MobX before unbundling.
19. **`tplToPlasmicElements()` is an MVP with SEVERE limitations — NOT USED by MCP server**: Per comments at `gen-element-repr-v2.ts:2-18`, it "intentionally starting scrappy" for SDUI use case. Only handles: `TplContainer` → `"box"`, `TplComponent` → `"component"`, `TplTextBlock` → `"text"`. **Ignores**: HTML tags, layout/styling, images, data bindings. Per `specs/plasmic-mcp-server.md`, the MCP server uses a custom tree reader that walks the Tpl model directly for full fidelity (see Phase 3 tree reader).
20. **`elementSchemaToTpl()` (server-side, for create-page) handles ALL element types**: `img`, `button`, `input`, `password`, `textarea`, `vbox`, `hbox`, `box`, `page-section`, `component`, `default-component`, `text`. Located in `code-components/code-components.ts:2703-3039`. With custom tree reader, the read/write paths have parity.
21. **`FastBundler.unbundle()` returns generic `ObjInst`**, NOT a narrowed `Site`. Must use `ensureInstance(result, Site, ProjectDependency)` then `isKnownSite()` guard to narrow. Both `Site` and guard functions come from generated `classes.ts`. See `bundle-migration-utils.ts` for the canonical pattern.
22. **`justClasses` is a generated const object** in `classes.ts` mapping class names to constructors (e.g., `{ Site, Component, TplNode, ... }`). Generated by `model-generator.ts:279-281`. Required by `Bundler` constructor via `classes.justClasses` and used by `InstUtil` for deserialization lookups.
23. **`PkgVersionInfo` can be defined locally**: The only import from `SharedApi.ts` needed by `tagged-unbundle.ts`. For MVP, dependency package loading can be skipped entirely — call `FastBundler.unbundle(bundle, projectId)` directly without loading deps. Cross-project component references may be unresolved (acceptable for Milestone 1).
24. **Dependency packages not addressed in MVP**: The server-side `unbundleSite()` in `bundle-migration-utils.ts` loads deps from DB via `loadDepPackages()`. For the MCP server, the REST API returns the project bundle only. Skipping deps means cross-project references are unresolved — acceptable limitation.
25. **`element-repr-v2.ts` (wab) type set differs from `element-types.ts` (host)**: Wab version lacks `ButtonElement`, `TextInputElement`, `page-section` in containers. Host version (`packages/host/src/element-types.ts`) is the canonical full-feature type spec used by `elementSchemaToTpl`.
26. **MobX version confirmed `6.13.6`** (exact pin in `platform/wab/package.json:334`). esbuild versions: root `0.17.18`, platform/wab `^0.18.0`. `tsconfig.types.json` exists at root for extending. No `@modelcontextprotocol/sdk` in monorepo yet — new dependency.

---

## Phase 1: Foundation

These items unblock everything else. Nothing can be built or tested until generated files exist and the package scaffold is in place.

- [x] **Generate PEG parsers and model files** ✓ ALREADY EXISTED
  - All 4 PEG parser .js files already present in `platform/wab/src/wab/gen/`
  - `classes.ts` (7,767 lines) and `classes-metas.ts` (6,724 lines) already generated

- [x] **Create `packages/plasmic-mcp/` package scaffold** ✓ COMPLETE
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

- [x] **Register `packages/plasmic-mcp` in root workspace** ✓ COMPLETE
  - What: Add `"packages/plasmic-mcp"` to the `workspaces` array in root `package.json` (currently has 24 packages + 47 plasmicpkgs + plasmicpkgs-dev = 72 entries)
  - Files: Root `package.json`
  - Depends on: Package scaffold

- [x] **Author spec: `specs/claude-code-skills.md`** ✓ COMPLETE
  - File exists with full specification for `/plasmic`, `/plasmic-create-page`, `/plasmic-inspect` skills, PlasmicElement type reference, and common patterns.

---

## Phase 2: esbuild Bundling

The MCP server must bundle code from `platform/wab/src/wab/shared/` into a standalone distributable. This is the hardest technical challenge. Key insight: by avoiding `tagged-unbundle.ts` and using `FastBundler.unbundle()` directly, we dodge the most dangerous import chains.

- [x] **Implement esbuild build script (`build.mjs`)** ✓ COMPLETE
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

- [x] **Resolve transitive dependency issues** ✓ COMPLETE
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

- [x] **Verify esbuild output works standalone** ✓ COMPLETE (1313 KB bundle, loads and starts)
  - What: Run `node packages/plasmic-mcp/build.mjs`, then `node packages/plasmic-mcp/dist/index.cjs` to verify no import errors. Check bundle size (target: under 2MB for shared code). Estimated ~570KB unminified, ~200KB minified.
  - Verification steps:
    1. Build succeeds with no errors
    2. `node dist/index.cjs` starts without import/require errors
    3. Metafile analysis shows no server-only or client-only code leaked in
    4. No references to `SharedApi`, `stripe`, `slate`, `@/wab/client/` in output
  - Files: `packages/plasmic-mcp/dist/index.cjs`
  - Risk: Runtime errors from dynamic requires or missing generated code.
  - Depends on: Resolved transitive dependencies

- [x] **Set up TypeScript configuration** ✓ COMPLETE (tsc --noEmit passes)
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

- [x] **Implement MCP server entry point and tool registration** ✓ COMPLETE
  - What: Set up `@modelcontextprotocol/sdk` with stdio transport. Use `McpServer` class (from `@modelcontextprotocol/sdk/server/mcp.js`) and `StdioServerTransport` (from `.../server/stdio.js`). Register tools using `server.registerTool(name, { title, description, inputSchema, outputSchema? }, handler)` where schemas use Zod. Tools must be registered before transport connection.
  - Critical: Never use `console.log()` — only `console.error()` for logging (stdout is JSON-RPC transport).
  - Files: `packages/plasmic-mcp/src/index.ts`, `packages/plasmic-mcp/src/server.ts`
  - Reference: MCP SDK docs (`typescript-sdk/docs/server.md`), `server.registerTool()` API
  - Depends on: esbuild bundling working

- [x] **Implement auth module** ✓ COMPLETE
  - What: Read `PLASMIC_AUTH_HOST`, `PLASMIC_AUTH_USER`, `PLASMIC_AUTH_TOKEN` from env vars. Validate user + token present on startup (host defaults to `https://studio.plasmic.app`). Optional fallback to `.plasmic.auth` JSON file. Support optional `basicAuthUser`/`basicAuthPassword` for gated instances.
  - Files: `packages/plasmic-mcp/src/auth.ts`
  - Reference: `packages/cli/src/utils/auth-utils.ts` — `getEnvAuth()` (reads same env vars, warns on partial), `readAuth()` (parses `.plasmic.auth` JSON with `{ host, user, token }` format, strips trailing slashes)
  - Type: `AuthConfig { host: string; user: string; token: string; basicAuthUser?: string; basicAuthPassword?: string; }`
  - Depends on: Server entry point

- [x] **Implement Plasmic API client** ✓ COMPLETE
  - What: HTTP client for Plasmic REST API. Use native `fetch` (Node 18+).
  - Methods needed:
    - `listProjects(query?)` → `GET /api/v1/projects` with query params `{ query: "all" }` (or `byIds`, `byWorkspace`). Returns `{ projects: ApiProject[], perms: ApiPermission[] }`. Auth: `x-plasmic-api-user`, `x-plasmic-api-token` headers.
    - `getProjectBundle(projectId)` → `GET /api/v1/projects/:projectId` (returns `{ rev: { data: string } }` where `data` is JSON-stringified Bundle)
    - `updateProject(projectId, body)` → `POST /api/v1/projects/:projectId` (body includes `newComponents`, `updateComponents`, `tokens`). Auth: same headers.
  - Error handling: Check for 403 → "Incorrect Plasmic credentials". Surface `response.data.error.message` when present. Separate `studioHost` (API calls) from potential `codegenHost` (future).
  - Files: `packages/plasmic-mcp/src/api-client.ts`
  - Reference: `packages/cli/src/api.ts` — `PlasmicApi` class (`makeHeaders()` pattern, error handling)
  - Depends on: Auth module

- [x] **Implement model loader (bundle fetch + unbundle)** ✓ COMPLETE
  - What: Fetch project bundle via API client, `JSON.parse(response.rev.data)` to get `Bundle`, then `new FastBundler(meta, classes).unbundle(bundle, projectId)` to produce live `Site` model. Store bundler instance and site in session state.
  - Key insight: Use `FastBundler` directly from `bundler.ts`, NOT `tagged-unbundle.ts`. This avoids the entire SharedApi import chain.
  - MUST initialize MobX before first unbundle: `import mobx from "@/wab/shared/import-mobx"; mobx.configure({ enforceActions: "never" });`
  - FastBundler constructor needs: `meta` (from `classes-metas.ts`), `classes` module (from `classes.ts` — specifically `classes.justClasses`).
  - **Type narrowing required**: `FastBundler.unbundle()` returns generic `ObjInst`. Must narrow: `const siteOrDep = ensureInstance(result, Site, ProjectDependency); const site = isKnownSite(siteOrDep) ? siteOrDep : siteOrDep.site;` (pattern from `bundle-migration-utils.ts`).
  - **Dependency loading skipped for MVP**: Unlike server-side `unbundleSite()` which loads deps from DB, the MCP server unbundles without deps. Cross-project component references will be unresolved.
  - Files: `packages/plasmic-mcp/src/model-loader.ts`
  - Depends on: API client, esbuild bundling verified

- [x] **Implement session state management** ✓ COMPLETE
  - What: Singleton session holding: active project ID, live `Site` model, `FastBundler` instance. Cleared when `set-project` is called with a different project.
  - Files: `packages/plasmic-mcp/src/session.ts`
  - Depends on: Model loader

- [x] **Implement tree reader (custom Tpl model walker)** ✓ COMPLETE
  - What: New code that walks the in-memory Tpl model directly to produce full-fidelity JSON. Does NOT use the degraded `tplToPlasmicElements()` function. Per `specs/plasmic-mcp-server.md`, the tree reader traverses:
    - `TplTag` → extracts `.tag` (HTML tag), `.type`, `.children`, `.vsettings[0].rs.values` (CSS styles), `.vsettings[0].text` (RichText), `.vsettings[0].attrs` (HTML attributes)
    - `TplComponent` → extracts `.component.name`, `.component.uuid`
    - `TplSlot` → extracts `.param.variable.name`, `.defaultContents`
  - Output includes: element type, HTML tag, CSS styles, text content, image sources, layout type, child hierarchy, referenced component names.
  - This is new code in `packages/plasmic-mcp/` — does not modify any upstream files. Imports model classes (`TplTag`, `TplComponent`, `TplSlot`, `RuleSet`, etc.) from the esbuild bundle.
  - Files: `packages/plasmic-mcp/src/tree-reader.ts`
  - Depends on: Session state, esbuild bundle (must include model classes and `RuleSetHelpers`)

---

## Phase 4: MCP Tools

Implement each tool handler. `set-project` must work before any model-reading tool.

- [x] **Tool: `set-project`** ✓ COMPLETE (in server.ts)
- [x] **Tool: `list-projects`** ✓ COMPLETE (in server.ts)
- [x] **Tool: `get-project-meta`** ✓ COMPLETE (in server.ts)
- [x] **Tool: `list-components`** ✓ COMPLETE (in server.ts)
- [x] **Tool: `get-component-tree`** ✓ COMPLETE (in server.ts, uses tree-reader.ts)
- [x] **Tool: `create-page`** ✓ COMPLETE (in server.ts, includes model reload after creation)

- [x] **Model reload after create-page** ✓ INCLUDED in create-page tool
  - What: Re-fetch bundle and re-unbundle after `create-page` succeeds so the new page appears in the in-memory model.
  - Depends on: `create-page`, model loader

---

## Phase 5: Claude Code Integration

Wire the MCP server into Claude Code and create skill files.

- [x] **Create `.claude/mcp.json`** ✓ COMPLETE
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

- [x] **Create skill: `/plasmic-create-page`** ✓ COMPLETE
  - What: `.claude/commands/plasmic-create-page.md`. Guides Claude through: set-project if needed, list-components, build PlasmicElement tree, call create-page, verify result.
  - Must include: PlasmicElement type reference, common patterns, CSS property format (camelCase), valid element types (`vbox`, `hbox`, `box`, `page-section`, `text`, `img`, `button`, `input`, `password`, `textarea`, `component`, `default-component`), valid HTML tags.
  - Files: `.claude/commands/plasmic-create-page.md`
  - Depends on: MCP tools working

- [x] **Create skill: `/plasmic-inspect`** ✓ COMPLETE
  - What: `.claude/commands/plasmic-inspect.md`. Read-only exploration: set-project, get-project-meta, list-components, optionally get-component-tree.
  - Files: `.claude/commands/plasmic-inspect.md`
  - Depends on: MCP tools working

- [x] **Create workflow: `/plasmic`** ✓ COMPLETE
  - What: `.claude/commands/plasmic.md`. Top-level router skill. Routes natural language to appropriate sub-workflows. Handles project selection, intent routing, and summarization.
  - Files: `.claude/commands/plasmic.md`
  - Depends on: Sub-skills created

---

## Phase 6: Testing and Validation

### What has been implemented

Test infrastructure and unit tests for all MCP server modules (81 tests, 7 suites).

- [x] **Jest configuration** ✓ COMPLETE
  - `packages/plasmic-mcp/jest.config.cjs` — `.cjs` extension required because package has `"type": "module"`
  - `moduleNameMapper` strips `.js` from ESM imports and maps `@/wab/` path aliases to test mocks
  - Root `jest.config.js` excludes `packages/plasmic-mcp` (has its own config with `@/wab/` mocks)
  - `tsconfig.json` excludes `src/__tests__` and `src/__mocks__` from type checking
  - `package.json` has `"test": "jest --config jest.config.cjs"` script

- [x] **Mock modules for @/wab/ path aliases** ✓ COMPLETE
  - `src/__mocks__/wab-classes.ts` — type guard functions (`isKnownTplTag` etc.) check `_type` property; `Site` and `ProjectDependency` classes with `isKnown()` static methods
  - `src/__mocks__/wab-classes-metas.ts` — empty `meta` and `CLASSES` objects
  - `src/__mocks__/wab-bundler.ts` — `FastBundler` class with `mockUnbundle` jest.fn() for per-test control

- [x] **Unit tests for auth.ts** ✓ COMPLETE (9 tests)
  - Env var auth (all present, trailing slashes, basic auth)
  - Validation (missing host, partial vars)
  - `.plasmic.auth` file fallback (complete, incomplete, trailing slashes)
  - Error messages are descriptive and actionable
  - Key pattern: `jest.resetModules()` + dynamic `require()` because esbuild transform doesn't hoist `jest.mock` calls

- [x] **Unit tests for api-client.ts** ✓ COMPLETE (10 tests)
  - Correct URL construction for all 3 endpoints
  - Auth headers (`x-plasmic-api-user`, `x-plasmic-api-token`, optional Basic auth)
  - Request body serialization (POST)
  - URL encoding of project IDs
  - Error handling: 403 auth failure, server error message, HTTP status fallback, network errors

- [x] **Unit tests for session.ts** ✓ COMPLETE (6 tests)
  - Singleton get/set/clear lifecycle
  - `requireSession()` throws actionable error when no project loaded
  - Session replacement on project switch

- [x] **Unit tests for model-loader.ts** ✓ COMPLETE (6 tests)
  - MobX initialization with `enforceActions: "never"`
  - Bundle fetch → parse → unbundle → narrowToSite pipeline
  - Site extraction from `ProjectDependency` result
  - Error on unexpected unbundle result type
  - Project name fallback when API response is incomplete

- [x] **Unit tests for tree-reader.ts** ✓ COMPLETE (21 tests)
  - TplTag: tag, uuid, name, nodeType, styles, layoutType, text, attrs, children
  - TplComponent: component name/uuid, props from args
  - TplSlot: slot name, default contents
  - Expression types: CustomCode (JSON + raw), RawText, ImageAssetRef (dataUri + url), StyleTokenRef, VarRef, RenderExpr
  - Layout derivation: vbox (column), hbox (row/default flex), box (non-flex)
  - Edge cases: null tplTree, empty styles, empty children, unknown node types

- [x] **Unit tests for token-reader.ts** ✓ COMPLETE (17 tests)
  - resolveTokenValue: primitives unchanged, single ref, chain resolution, cycle detection, missing ref
  - readTokens: all tokens grouped by type, correct fields, type filtering (all 6 types), empty/null input
  - Token references: resolvedValue present when ref, omitted for primitives, multi-hop chains, cycles, unresolvable refs

- [x] **Integration smoke test for server.ts** ✓ COMPLETE (2 tests)
  - `createServer()` succeeds with valid auth and registers all tools
  - `createServer()` throws descriptive error when auth is not configured

### Test findings

1. **esbuild jest transform doesn't hoist `jest.mock` calls**: Unlike babel-jest or ts-jest, the esbuild transform only does TS→JS conversion. `jest.mock("fs")` at module level runs AFTER imports are resolved, so the mock isn't applied. Fix: use `jest.resetModules()` + `jest.mock()` + dynamic `require()` per test.
2. **Jest config must be `.cjs`**: Package has `"type": "module"` so `.js` files are ESM. Jest config uses `module.exports` (CJS), so it needs `.cjs` extension.
3. **`@/wab/` mocks need explicit `moduleNameMapper`**: The root jest config doesn't know about `@/wab/` path aliases. A package-level jest config maps these to mock files.

### What remains

- [ ] **Manual end-to-end test with Claude Code**
  - Requires self-hosted Plasmic instance with valid credentials.
  - Depends on: All phases complete

---

## Phase 7: Nice-to-Haves

- [x] **Tool: `get-tokens`** ✓ COMPLETE — Reads `site.styleTokens`, resolves token references (`var(--token-<uuid>)` chains with cycle detection), groups by type (Color/Spacing/FontSize/LineHeight/FontFamily/Opacity), optional type filter. `token-reader.ts` module + 17 tests. All 3 skill files updated to reference the tool.
- [x] **PlasmicElement pattern library** ✓ COMPLETE — `.claude/commands/plasmic-patterns.md` with 10 validated patterns: hero, feature grid, card, contact form, navigation header, footer, pricing table (3-tier), testimonial, CTA section, image gallery. Includes CSS rules (no shorthand `border`/`transition`), valid element types, valid tags, composition guide, and component reference pattern. All patterns validated against `elementSchemaToTpl()` server-side handling. Cross-references added to `/plasmic-create-page` and `/plasmic` skills.
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
  Tree reader (custom Tpl walker) ──────┘
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

## Implementation Notes (from build)

### esbuild Plugin Architecture (5 layers)
1. **Layer 1**: `@/` prefix → resolve to `platform/wab/src/`, externalize client/server paths
2. **Layer 2**: Relative imports from within wab → externalize if they escape to client/server
3. **Layer 3**: `src/wab/` prefix (malformed `@/` aliases) → same as Layer 1
4. **Layer 4**: Stub modules for optional packages (`@plasmicapp/*`, `@plasmicpkgs/*`, `antd`, `react`) — wab shared code imports these but MCP server doesn't need them at runtime. Uses Proxy-based empty module stubs.
5. **Layer 5**: Externalize ALL remaining bare npm package imports → resolved from node_modules at runtime

### Dependency Version Alignment
All dependency versions in `packages/plasmic-mcp/package.json` match versions installed in `platform/wab/node_modules/`, NOT root `node_modules/`. Key mismatches discovered:
- `ts-failable`: 0.6.1 (not 2.x), `css-initials`: 0.3.1 (not 4.x), `css-tree`: 3.1.0 (not 1.x or 2.x)
- `mime`: 2.6.0 (not 3.x), `semver`: 6.3.1 (not 7.x), `uuid`: 11.1.0 (not 8.x or 9.x)

### TypeScript Strategy
- TypeScript can't resolve `@/` path aliases into the wab codebase (different tsconfig context)
- Solution: `src/wab.d.ts` provides minimal type declarations for the specific wab modules we import
- `tsc --noEmit` validates our own code; esbuild handles the actual wab code bundling

### Bundle Characteristics
- Output: CJS format, ~1.3 MB, 54 external npm packages
- All wab shared code bundled inline; all npm packages resolved at runtime
- Optional packages (react, antd, @plasmicapp/*) stubbed with Proxy objects

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
| MCP SDK `zod` version mismatch | SDK fails with `_parse is not a function` | Use `zod@^3.25.0` (or v4); test import at build time |
| `GET /api/v1/projects` requires specific query format | list-projects returns empty | Use `{ query: "all" }` query parameter (confirmed `ProjectsRequest` ADT) |
| Custom tree reader implementation complexity | New code needed to walk Tpl model with full fidelity | Per spec, write a custom walker in `tree-reader.ts` that reads `TplTag`, `TplComponent`, `TplSlot` directly from model. More work than wrapping `tplToPlasmicElements()` but provides full-fidelity output. |
| `FastBundler.unbundle()` returns generic `ObjInst` | Type errors if not narrowed properly | Use `ensureInstance(result, Site, ProjectDependency)` + `isKnownSite()` guard pattern from `bundle-migration-utils.ts` |
| Cross-project component references unresolved | Components from other projects show as broken refs | MVP limitation — skip dependency loading. Document that `set-project` loads single project only. |
| Custom tree reader output format design | Must produce JSON Claude can use to understand pages and create new ones | Design output format inspired by `PlasmicElement` types from `packages/host/src/element-types.ts` but enriched with CSS styles and HTML tags from the Tpl model |

## Spec Corrections

The following corrections were identified during deep code analysis:

1. **PEG parser output path**: Correct location is `platform/wab/src/wab/gen/` (NOT `platform/wab/gen/`). The Makefile rule is `src/wab/gen/%.js: %.pegcoffee`. The `@/wab/gen/` import path resolves to `src/wab/gen/` via tsconfig `@/*` → `./src/*` mapping.
2. **PEG parser generation command**: Use `yarn make` (runs `cd platform/wab && make`), NOT `yarn setup:wab`. The `setup:wab` script only runs `cd platform/wab && yarn` (dependency install). The Makefile compiles PEG parsers.
3. **Path to `gen-element-repr-v2.ts`**: Actual location is `platform/wab/src/wab/shared/element-repr/gen-element-repr-v2.ts`, not `codegen/gen-element-repr-v2.ts`.
4. **`gen-element-repr-v2.ts` transitive deps have benign react imports**: `RuleSetHelpers.ts` imports `CSSProperties` from `react` (value import of a type), `tpls.ts` has `import type { ViewCtx }` from `@/wab/client/` (erased by esbuild). Both handled by externalizing `react` and the client-path plugin.
5. **`common.ts` imports react**: `import { Key } from "react"` — must externalize react.
6. **`gen-element-repr-v2.ts` and `RuleSetHelpers.ts` are safe to bundle**: With the above externals in place, the full import chain for shared model code works in Node.js. The custom tree reader uses `RuleSetHelpers` for reading CSS from RuleSets.
7. **`create-page` uses `POST`** not `PUT`: Component creation goes through `POST /api/v1/projects/:projectId`.
8. **`tagged-unbundle.ts` only needs a type from `SharedApi.ts`**: Specifically `PkgVersionInfo`. Bypass entirely by using `FastBundler.unbundle()` directly.
9. **`list-projects` endpoint confirmed**: `GET /api/v1/projects` exists at `AppServer.ts:1528`. Uses `teamApiUserAuth` middleware. Accepts `ProjectsRequest` ADT query parameter.
10. **CLI has no `listProjects()` method**: MCP server must implement this from scratch. The CLI's `PlasmicApi` is codegen-focused.
11. **MCP SDK API**: Use `McpServer` class with `server.registerTool()` (not `Server` + `setRequestHandler`). Input schemas use flat Zod records, not JSON Schema.
12. **Additional externals discovered**: `dayjs`, `uuid`, `immutable`, `nanoid`, `classnames`, `short-uuid` (from `common.ts`), `@plasmicapp/host` (from `model-util.ts`).
13. **`tplToPlasmicElements()` NOT used by MCP server**: The spec (`plasmic-mcp-server.md`) explicitly requires a custom tree reader that walks the Tpl model directly for full fidelity. The degraded `tplToPlasmicElements()` function is an SDUI MVP that drops styles, images, and layout types — it is NOT suitable for the MCP `get-component-tree` tool. The custom tree reader in `tree-reader.ts` provides full read/write parity.
14. **`FastBundler.unbundle()` return type is generic**: Returns `ObjInst` (union of all model classes). The model-loader must use `ensureInstance(result, Site, ProjectDependency)` + `isKnownSite()` to narrow to `Site`. Both are exports from generated `classes.ts`.
15. **`element-types.ts` (host) is canonical for create-page**: The `packages/host/src/element-types.ts` defines the full `PlasmicElement` union type used by `elementSchemaToTpl` on the server side. The custom tree reader should produce output compatible with this type spec.
16. **`genReprV3` exists in `loader.ts`**: Server-side only (requires DB access via `superDbMgr`). Not usable by the MCP server. No standalone v3 element repr module exists.
17. **`UpdateProjectReq` request body confirmed**: `{ newComponents?: NewComponentReq[], updateComponents?: NewComponentReq[], tokens?: UpsertTokenReq[], updateGlobalContexts?: UpdateGlobalContextReq[], branchId?: string }`. Each `NewComponentReq` has `{ name?, body: PlasmicElement, path?, byUuid?, cloneFrom? }`.
18. **Auth middleware chain confirmed**: `POST /api/v1/projects/:projectId` uses `cors, teamApiUserAuth, apiAuth, updateProjectData`. The `apiAuth` middleware validates `x-plasmic-api-token` + `x-plasmic-api-user` headers (among other auth methods).
