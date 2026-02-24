# Build & Run

```bash
cd plasmicpkgs/commerce-providers/elastic-path && yarn build   # tsdx build for EP commerce package
cd plasmicpkgs-dev && yarn dev                                 # Next.js dev server for testing components
```

# Validation

```bash
cd plasmicpkgs/commerce-providers/elastic-path && yarn build   # TypeScript compilation via tsdx
yarn test                                                       # Jest unit tests (from root)
yarn eslint --fix                                               # ESLint with auto-fix
yarn prettier --write                                           # Prettier formatting
```

# Key Patterns

- Monorepo managed with yarn workspaces
- EP commerce package at `plasmicpkgs/commerce-providers/elastic-path/`
- Commerce framework forked from Vercel Commerce — uses SWR-style hooks via `useMutablePlasmicQueryData` from `@plasmicapp/query`
- Plasmic component registration pattern: each component has a `register*` function and `*Meta` object
- EP SDK: `@epcc-sdk/sdks-shopper` for all Elastic Path API calls — always pass `client` parameter
- Cart operations must include `location` in update body for location-based inventory items
- Cart item removal uses `deleteACartItem` (DELETE endpoint), not quantity-to-zero
- `DataProvider` / `useSelector` pattern for parent-to-child data flow in Plasmic components
- Use explicit `git add <files>` — never `git add -A` or `git add .`

# Testing Notes

- esbuild hoists `import` to `require()` at file top, before `jest.mock()`. Use `require()` (not `import`) for code-under-test to ensure mocks load first.
