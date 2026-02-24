# esbuild Bundling of Plasmic Editing Engine

## Jobs to Be Done
- As the MCP server package, I need the Plasmic editing engine (bundler, model classes, element-repr) bundled into a standalone npm package so that consumers can `npx @elasticpath/plasmic-mcp` without access to the monorepo.
- As a developer maintaining this package, I want a clear build strategy for bundling `platform/wab/src/wab/shared/` code that hasn't been extracted into a package before.

## Context: Why This Is New

No existing package in the Plasmic monorepo bundles code from `platform/wab/src/wab/shared/`. The current patterns are:
- Packages define their own types locally (e.g., `packages/host/src/element-types.ts`)
- `platform/wab/` imports FROM packages, not the other way around
- Packages depend on other published `@plasmicapp` packages

This package pioneers a new pattern: using esbuild to bundle a subset of `platform/wab/src/wab/shared/` into a standalone distributable.

### Upstream Merge Constraint
This monorepo is a fork that regularly pulls from upstream Plasmic. The esbuild bundling approach is specifically chosen to avoid modifying any upstream files:
- **Read-only consumption** — we import from `platform/wab/src/wab/shared/` but never modify those files
- **No new exports needed** — esbuild follows imports directly from source, no changes to barrel files
- **New package only** — everything lives in `packages/plasmic-mcp/`, a directory that doesn't exist upstream
- **If shared code changes upstream** — we rebuild; the bundle picks up the new code automatically
- **Never add wrapper modules or re-exports to `platform/wab/`** — if the bundler can't reach something, create a local adapter in `packages/plasmic-mcp/src/` instead

## Acceptance Criteria
- [ ] esbuild resolves `@/wab/shared/...` path aliases from `platform/wab/tsconfig.json`
- [ ] Bundled output includes: FastBundler, model classes, `tplToPlasmicElements()`, `unbundleSite()`
- [ ] `mobx` is treated as an external dependency (not bundled, listed in package.json dependencies)
- [ ] Output is a single CJS entry point suitable for `npx` execution
- [ ] Bundle size is reasonable (target: under 2MB for the shared code portion)
- [ ] TypeScript type checking passes for the MCP server source code (imports from shared code resolve)
- [ ] Published package works standalone: `npx @elasticpath/plasmic-mcp` starts without monorepo
- [ ] Build is reproducible: same source → same output

## Happy Path
1. Developer runs `node packages/plasmic-mcp/build.mjs`
2. esbuild resolves entry point `src/index.ts`
3. Imports into `platform/wab/src/wab/shared/` are followed and bundled inline
4. `@/` path alias resolves to `platform/wab/src/`
5. `mobx` imports remain external (`require("mobx")` in output)
6. `@modelcontextprotocol/sdk` remains external
7. Output: `packages/plasmic-mcp/dist/index.cjs` — single file, all shared code inlined
8. `npx @elasticpath/plasmic-mcp` works on any machine with Node.js 18+

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Circular imports in shared code | esbuild handles circular imports natively — no action needed |
| Dynamic `require()` in shared code | May fail at runtime. Audit bundled code for dynamic requires and replace with static imports. |
| Missing type in model classes | Model classes are generated from `model-schema.ts`. If generated code changes, rebuild. |
| Path alias not resolving | Build fails clearly: "Could not resolve @/wab/shared/..." — check esbuild alias config. |
| Shared code imports server-only modules | Use esbuild tree-shaking. If server code leaks in, add to external list or use `--ignore-annotations` false. |
| Large bundle size | Profile with `--metafile` and `--analyze`. Remove unused code paths from entry points. |
| MobX version mismatch | Pin MobX version in package.json to match `platform/wab/package.json` |

## Out of Scope
- Extracting shared code into a separate `@plasmicapp/editing-engine` package (future consideration)
- Bundling MobX into the output (kept external)
- Bundling socket.io-client (future milestone, kept external)
- Auto-rebuilding when platform/wab changes (manual rebuild required)
- Generating TypeScript declarations for the bundled shared code

## Technical Notes

### What Needs to Be Bundled

From `platform/wab/src/wab/shared/`:

| Module | Purpose | Key exports |
|--------|---------|-------------|
| `bundler.ts` | Bundle/unbundle project data | `FastBundler`, `Bundle` type |
| `model/classes.ts` | Generated model classes | `Site`, `Component`, `TplTag`, `TplNode`, `TplComponent`, `TplSlot`, `Variant`, `VariantSetting`, `RuleSet`, `StyleToken` |
| `model/classes-metas.ts` | Model metadata (field types, refs) | `meta` |
| `model/InstUtil.ts` | Instance utilities | `instUtil` |
| `element-repr/gen-element-repr-v2.ts` | Tpl → PlasmicElement conversion | `tplToPlasmicElements()` |
| `core/tagged-unbundle.ts` | Site unbundling with deps | `unbundleSite()` |
| `bundles.ts` | Bundle type definitions | `Bundle`, `BundledInst` |
| `common.ts` (partial) | Utility functions used by above | Various helpers |

### Path Alias Resolution

`platform/wab/tsconfig.json` defines:
```json
{
  "compilerOptions": {
    "baseUrl": "./",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

So `import { FastBundler } from "@/wab/shared/bundler"` resolves to `platform/wab/src/wab/shared/bundler.ts`.

esbuild config must replicate this:
```javascript
const alias = {
  "@/wab/shared": path.resolve(__dirname, "../../platform/wab/src/wab/shared"),
  "@/wab/client": path.resolve(__dirname, "../../platform/wab/src/wab/client"),
  // Add more as needed based on actual imports
};
```

### External Dependencies

These should NOT be bundled (listed in `package.json` dependencies instead):
- `mobx` — reactive state (version must match platform/wab)
- `@modelcontextprotocol/sdk` — MCP protocol
- `lodash` — utilities used by shared code
- Node.js built-ins (`fs`, `path`, `crypto`, etc.)

### Build Configuration

```javascript
// packages/plasmic-mcp/build.mjs
import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: "dist/index.cjs",
  sourcemap: true,
  metafile: true,  // for bundle analysis

  // Path alias resolution
  alias: {
    "@/wab/shared": path.resolve(__dirname, "../../platform/wab/src/wab/shared"),
    "@/wab/client": path.resolve(__dirname, "../../platform/wab/src/wab/client"),
  },

  // Keep these as external (not bundled)
  external: [
    "mobx",
    "@modelcontextprotocol/sdk",
    "lodash",
    "socket.io-client",  // future milestone
  ],
});
```

### TypeScript Configuration

```json
// packages/plasmic-mcp/tsconfig.json
{
  "extends": "../../tsconfig.types.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": ".",
    "paths": {
      "@/wab/shared/*": ["../../platform/wab/src/wab/shared/*"],
      "@/wab/client/*": ["../../platform/wab/src/wab/client/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "references": []
}
```

### Investigation Needed During Build

These unknowns must be resolved during implementation:

1. **Transitive imports** — The shared modules import other shared modules. The full dependency graph needs to be mapped. Run esbuild with `--metafile` and analyze which files get pulled in.

2. **Server-side code leaking** — `bundler.ts` or `tagged-unbundle.ts` may import from `@/wab/server/` which should NOT be bundled. If so, either:
   - Add those paths to the external list
   - Create thin wrapper modules that only import what's needed
   - Use esbuild's `--tree-shaking=true` to eliminate dead code

3. **Generated model classes** — `classes.ts` is generated from `model-schema.ts`. Need to determine:
   - Is the generated file checked into git? (likely yes)
   - Does it have runtime dependencies beyond MobX?
   - Size of the generated code

4. **MobX version compatibility** — Check which MobX version `platform/wab/package.json` uses and pin the same version.

5. **`common.ts` bloat** — `platform/wab/src/wab/shared/common.ts` is a large utility file. Tree-shaking should handle it, but verify the bundled output doesn't include the entire file.

### Build Verification Steps

After building, verify:
1. `node dist/index.cjs` starts without import errors
2. `npx . --help` shows available tools (from the built package directory)
3. Bundle analysis (`--metafile`): no server-only code included
4. File size check: total output under 2MB
5. Import test: `require("./dist/index.cjs")` resolves all bundled shared code

### Reference: How Other Packages Build

**Root `build.mjs`** (used by most packages/):
- esbuild with `bundle: true, packages: "external"`
- Generates both CJS and ESM
- Uses `@microsoft/api-extractor` for `.d.ts` rollup

**`packages/cli/build.sh`** (closest precedent as a complex bundled package):
- Direct esbuild CLI: `esbuild src/index.ts --outdir=./dist --bundle --platform=node --format=cjs`
- Bundles everything except node_modules
- Then `tsc --emitDeclarationOnly` for types

Our build follows the CLI pattern most closely — single bundled CJS output for Node.js.

### Package.json Shape

```json
{
  "name": "@elasticpath/plasmic-mcp",
  "version": "0.1.0",
  "description": "MCP server for Plasmic Studio with embedded editing engine",
  "bin": {
    "plasmic-mcp": "./dist/index.cjs"
  },
  "main": "./dist/index.cjs",
  "scripts": {
    "build": "node build.mjs",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "mobx": "<pin to platform/wab version>",
    "lodash": "<pin to platform/wab version>"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "engines": {
    "node": ">=18"
  },
  "publishConfig": {
    "access": "public"
  }
}
```
