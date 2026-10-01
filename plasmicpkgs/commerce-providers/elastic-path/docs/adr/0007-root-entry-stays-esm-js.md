# ADR-0007: The root entry stays `.esm.js`; only `/server` ships `.mjs`

## Status

Accepted (2026-09-30)

## Context

The package builds with the repository's shared `build.mjs`. `verify:package`
runs publint and arethetypeswrong on the packed tarball on every pull request.
Without `"type": "module"`, a `.js` file is CommonJS to Node, so any ESM build
that Node itself loads must be named `.mjs`.

`/server` is loaded by Node directly, including from ESM-only modules such as a
Next.js `instrumentation.ts`. It ships `server.mjs` and `server.d.mts` via
`build.mjs --mjs`, and passes both tools with no exceptions.

The root entry is a React component library. Its consumers are bundlers:

- the storefront's Next build, which reads `module` and the `import` condition;
- the Studio canvas, where `platform/canvas-packages` bundles the root as an
  IIFE with `@plasmicapp/host` external and supplies it at run time;
- the hostless loader bundle that wab builds server-side, which externalises
  `@plasmicapp/host` the same way.

The source default-imports `@plasmicapp/host/registerComponent` and
`@plasmicapp/host/registerGlobalContext`, which are CommonJS at run time. When
esbuild bundles an importer named `.esm.js`, its interop gives the default
import the function. When it bundles an importer named `.mjs`, it applies Node's
rule instead, and the default import is the whole `module.exports` object. So
`registerAll` throws `registerGlobalContext.default is not a function` in every
canvas. `verify:package` reproduces this.

## Decision

The root entry stays on the `.esm.js` shape: `index.js`, `index.esm.js`,
`index.d.ts`. `build.mjs` refuses `--mjs` for an index entry.

The root entry's findings below are recorded exceptions. `verify:package`
ignores them by exact rule and path, so a new finding still fails CI:

| Tool | Finding | Rule / code |
| --- | --- | --- |
| arethetypeswrong | node16 from ESM: "Unexpected module syntax" | `unexpected-module-syntax`, root entry only |
| publint | `exports["."].import` is ESM but interpreted as CJS | `FILE_INVALID_FORMAT` at `exports > . > import` |
| publint | `exports["."].types` is interpreted as CJS under `import` | `EXPORTS_TYPES_INVALID_FORMAT` at `exports > . > types` |

The two publint lines are the same cause as the arethetypeswrong line, seen
from the JavaScript side and from the types side. arethetypeswrong runs twice
because its ignore is global: once for `.` with the ignore, once for `./server`
with none.

## Consequences

- A consumer that imports the root entry through native Node ESM, with no
  bundler, cannot load it. Node 22 detects the module syntax and parses the
  file as ESM, then refuses the directory import of
  `@plasmicapp/host/registerGlobalContext`. The package is not used in that
  environment, and 0.8.0 failed the same way.
- Fixing this needs `"type": "module"` or renaming the CommonJS build to
  `.cjs`. Both change how every consumer resolves the package, and both are out
  of scope until a consumer needs native ESM for the root.
- Do not re-file the root findings as defects. Change this ADR instead.
