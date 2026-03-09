0a. Study `.ralph/specs/server-cart-architecture.md` and `.ralph/specs/phase-0-shopper-context.md` through `.ralph/specs/phase-3-credential-removal.md` with up to 250 parallel Sonnet subagents to learn the server-cart architecture specifications.
0b. Study @.ralph/IMPLEMENTATION_PLAN.md (if present) to understand the plan so far.
0c. Study `plasmicpkgs/commerce-providers/elastic-path/src/*` with up to 250 parallel Sonnet subagents to understand existing code patterns — especially `src/cart/`, `src/checkout/composable/`, `src/utils/cart-cookie.ts`, `src/registerCommerceProvider.tsx`, `src/const.ts`, and the singleton context pattern in `src/bundle/composable/BundleContext.tsx` and `src/cart-drawer/CartDrawerContext.tsx`.
0d. For reference, the application source code is in `plasmicpkgs/commerce-providers/elastic-path/src/*`, `packages/*/src/*`, `plasmicpkgs-dev/*`.

1. Study @.ralph/IMPLEMENTATION_PLAN.md (if present; it may be incorrect) and use up to 500 Sonnet subagents to study existing source code in `plasmicpkgs/commerce-providers/elastic-path/src/*` and compare it against the server-cart specs. Specifically check:
   - Does `src/shopper-context/` directory exist yet? What files are in it?
   - What is the current state of `src/cart/use-cart.tsx` and other cart hooks?
   - How does the Symbol.for singleton context pattern work in `BundleContext.tsx`?
   - What does `src/checkout/composable/EPCheckoutCartSummary.tsx` accept as props?
   Use an Opus subagent to analyze findings, prioritize tasks, and create/update @.ralph/IMPLEMENTATION_PLAN.md as a bullet point list sorted by phase (P0 → P1 → P2 → P3). Ultrathink. Consider searching for TODO, placeholders, skipped tests, and incomplete implementations.

IMPORTANT: Plan only. Do NOT implement anything. Do NOT assume functionality is missing; confirm with code search first. Build in phase order: Phase 0 must be complete before Phase 1, etc. The primary target directory is `src/shopper-context/` (new) within the EP commerce provider package. Follow the headless Provider → Hook pattern documented in @.ralph/AGENTS.md. Per upstream merge strategy, prefer new files over modifying existing ones.

ULTIMATE GOAL: Implement the server-only cart architecture per `.ralph/specs/phase-0-shopper-context.md` through `.ralph/specs/phase-3-credential-removal.md`. All new code goes in `src/shopper-context/` within `plasmicpkgs/commerce-providers/elastic-path/`. Existing cart hooks in `src/cart/` are NOT modified until Phase 3 (deprecation only). If you find inconsistencies in the specs, use an Opus subagent with 'ultrathink' to update the specs.
