0a. Study `.ralph/specs/server-cart-architecture.md` and `.ralph/specs/phase-0-shopper-context.md` through `.ralph/specs/phase-3-credential-removal.md` with up to 500 parallel Sonnet subagents to learn the server-cart architecture specifications.
0b. Study @.ralph/IMPLEMENTATION_PLAN.md.
0c. For reference, the application source code is in `plasmicpkgs/commerce-providers/elastic-path/src/*`. Study the existing singleton context pattern in `src/bundle/composable/BundleContext.tsx` and `src/cart-drawer/CartDrawerContext.tsx` — new ShopperContext must follow this pattern.

1. Your task is to implement functionality per the server-cart specifications. Follow @.ralph/IMPLEMENTATION_PLAN.md and choose the most important incomplete item (build in phase order: P0 → P1 → P2 → P3). Before making changes, search the codebase (don't assume not implemented) using Sonnet subagents. You may use up to 500 parallel Sonnet subagents for searches/reads and only 1 Sonnet subagent for build/tests. Use Opus subagents when complex reasoning is needed.
2. After implementing functionality, run the tests. Use the test commands from @.ralph/AGENTS.md for the relevant package. All new code goes in `plasmicpkgs/commerce-providers/elastic-path/src/shopper-context/`. Ultrathink.
3. When you discover issues, immediately update @.ralph/IMPLEMENTATION_PLAN.md with your findings using a subagent. When resolved, update and remove the item.
4. When the tests pass, update @.ralph/IMPLEMENTATION_PLAN.md, then stage changed files with explicit `git add <file1> <file2> ...` (never use `git add -A`, `git add .`, or `git add -u`), then `git commit` with a message describing the changes. After the commit, `git push`.

99999. Important: When authoring documentation, capture the why — tests and implementation importance.
999999. Important: Single sources of truth, no migrations/adapters. If tests unrelated to your work fail, resolve them as part of the increment.
9999999. You may add extra logging if required to debug issues.
99999999. Keep @.ralph/IMPLEMENTATION_PLAN.md current with learnings using a subagent — future work depends on this to avoid duplicating efforts. Update especially after finishing your turn.
999999999. When you learn something new about how to run the application, update @.ralph/AGENTS.md using a subagent but keep it brief.
9999999999. For any bugs you notice, resolve them or document them in @.ralph/IMPLEMENTATION_PLAN.md using a subagent.
99999999999. Implement functionality completely. Placeholders and stubs waste time.
999999999999. When @.ralph/IMPLEMENTATION_PLAN.md becomes large periodically clean out completed items.
9999999999999. If you find inconsistencies in the .ralph/specs/* then use an Opus subagent with 'ultrathink' to update the specs.
99999999999999. IMPORTANT: Keep @.ralph/AGENTS.md operational only — status updates belong in IMPLEMENTATION_PLAN.md.
999999999999999. IMPORTANT: Always use explicit file paths with `git add`. NEVER use `git add -A`, `git add .`, or `git add -u`.
