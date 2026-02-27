0a. Study `.ralph/specs/*` with up to 50 parallel Sonnet subagents to learn the application specifications.
0b. Study @.ralph/IMPLEMENTATION_PLAN.md (if present) to understand the plan so far.
0c. Study the existing package source at `packages/plasmic-registry/src/*` (will be renamed to `packages/plasmic-mcp-registry/`) and the consumer integration at `plasmicpkgs-dev/` with parallel Sonnet subagents.
0d. Study the MCP server dev host sync code on the `mcp-plasmic-host-connection` branch if accessible, or search for `fetchDevHostRegistry` in `packages/plasmic-mcp/src/`.
0e. Study the five global registry source files at `packages/host/src/register*.ts` to understand the shapes of `__PlasmicComponentRegistry`, `__PlasmicContextRegistry`, `__PlasmicFunctionsRegistry`, `__PlasmicTokenRegistry`, and `__PlasmicTraitRegistry`.

1. Study @.ralph/IMPLEMENTATION_PLAN.md (if present; it may be incorrect) and use up to 100 Sonnet subagents to study existing source code in `packages/plasmic-registry/src/*`, `plasmicpkgs-dev/`, and `packages/plasmic-mcp/src/devhost-sync*` and compare against `.ralph/specs/*`. Use an Opus subagent to analyze findings, prioritize tasks, and create/update @.ralph/IMPLEMENTATION_PLAN.md as a bullet point list sorted in priority of items yet to be implemented. Ultrathink. Consider searching for TODO, minimal implementations, placeholders, skipped/flaky tests, and inconsistent patterns. Study @.ralph/IMPLEMENTATION_PLAN.md to determine starting point for research and keep it up to date with items considered complete/incomplete using subagents.

IMPORTANT: Plan only. Do NOT implement anything. Do NOT assume functionality is missing; confirm with code search first. Treat `packages/plasmic-registry/` (soon `packages/plasmic-mcp-registry/`) as the registry package, `plasmicpkgs-dev/` as the consumer host app, and `packages/plasmic-mcp/` as the MCP server.

ULTIMATE GOAL: Build the @elasticpath/plasmic-mcp-registry package that exposes all five Plasmic global registries via an HTTP endpoint, with a Next.js config wrapper for RSC compatibility, so the MCP server can sync code component metadata (variants, props, states, tokens, traits) from the dev host without requiring a live Plasmic Studio connection.

Key source locations:
- Registry package: `packages/plasmic-registry/` (to be renamed `packages/plasmic-mcp-registry/`)
- Consumer host app: `plasmicpkgs-dev/` (next.config.js, app/api/plasmic-registry/route.ts, plasmic-register.ts)
- MCP server: `packages/plasmic-mcp/src/` (devhost-sync.ts, server.ts)
- Host registration sources: `packages/host/src/registerComponent.ts`, `registerGlobalContext.ts`, `registerFunction.ts`, `registerToken.ts`, `registerTrait.ts`
