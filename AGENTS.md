# Build & Run

```bash
cd platform/wab && yarn dev   # Plasmic Studio dev server
yarn setup                    # Full monorepo setup (all packages)
```

# Validation

```bash
jest                          # Jest unit tests (root — excludes plasmic-mcp)
cd packages/plasmic-mcp && npm test  # plasmic-mcp tests (own jest config with @/wab/ mocks)
tsc --noEmit                  # TypeScript type checking
yarn prettier --write         # Prettier formatting
yarn eslint --fix             # ESLint linting
```

`packages/plasmic-mcp` has its own `jest.config.cjs` (`.cjs` because `"type": "module"`) with `moduleNameMapper` for `@/wab/` path aliases. Root jest config excludes it.

E2E tests (`cd platform/wab && yarn cypress open`) require environment setup — do not run in the loop.

# Key Patterns

- Monorepo: platform/ (apps), packages/ (SDK), plasmicpkgs/ (code components), examples/ (references)
- Package manager: yarn (v1.22.21) with workspaces
- Build: common build script via `build.mjs` for packages/
- Lint: shared `.eslintrc.js` config, shared `jest.config.js`
- Libraries: React, MobX, TypeORM, Jest, Playwright, Storybook
- Use explicit `git add <files>` — never `git add -A` or `git add .`

# Upstream Merge Strategy

This is a fork that regularly pulls from upstream Plasmic. To minimize merge conflicts:

- **Prefer new files over modifying existing ones.** Put new functionality in its own module and import it where needed, rather than adding code inline to existing files.
- **Keep changes to upstream files minimal.** If you must modify an existing file, make the smallest possible change (e.g., a single import + function call) and put the implementation in a new file.
- **New packages are free.** Adding `packages/plasmic-mcp/` creates zero merge conflicts. Editing `platform/wab/src/wab/server/routes/projects.ts` creates many.
- **Avoid reformatting or reorganising upstream files.** Even well-intentioned cleanups cause conflicts on the next merge.
