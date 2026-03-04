# Build & Run

```bash
cd packages/plasmic-mcp && npm run dev    # Start MCP dev server (tsx)
cd packages/plasmic-mcp && npm run build  # Build distribution (dist/index.cjs)
```

# Validation

```bash
cd packages/plasmic-mcp && npm test              # All tests (~1,470 — unit + integration)
cd packages/plasmic-mcp && npm run test:unit      # Unit tests only (mocked WAB)
cd packages/plasmic-mcp && npm run test:integration  # Integration tests (real WAB)
cd packages/plasmic-mcp && npm run typecheck      # TypeScript type checking (tsc --noEmit)
```

`packages/plasmic-mcp` uses Vitest with a root `vitest.config.ts` referencing two project configs: `vitest.config.unit.ts` (mocked WAB via aliases) and `vitest.config.integration.ts` (real WAB source).

# Key Patterns

- Monorepo: platform/ (apps), packages/ (SDK), plasmicpkgs/ (code components)
- MCP server source: `packages/plasmic-mcp/src/`
- Plasmic registry package: `packages/plasmic-mcp-registry/` (tests: `cd packages/plasmic-mcp-registry && npx vitest run`)
- STRAP architecture: 8 domain tools (project, inspect, component, node, variant, design, data, interaction) consolidating 104 actions
- Embedded WAB editing engine from `platform/wab/src/wab/`
- Claude Code skills in `.claude/commands/` (6 slash commands)
- Use explicit `git add <files>` — never `git add -A` or `git add .`

# Upstream Merge Strategy

This is a fork that regularly pulls from upstream Plasmic. To minimize merge conflicts:

- **Prefer new files over modifying existing ones.** Put new functionality in its own module and import it where needed.
- **Keep changes to upstream files minimal.** Make the smallest possible change and put implementation in a new file.
- **New packages are free.** Adding `packages/plasmic-mcp/` creates zero merge conflicts.
- **Avoid reformatting or reorganising upstream files.** Even well-intentioned cleanups cause conflicts on the next merge.
