# Build & Run

```bash
# EP Commerce components (primary target)
cd plasmicpkgs/commerce-providers/elastic-path && yarn build

# MCP server (if needed)
cd packages/plasmic-mcp && npm run dev    # Start MCP dev server (tsx)
cd packages/plasmic-mcp && npm run build  # Build distribution (dist/index.cjs)
```

# Validation

```bash
# EP Commerce component tests (primary target)
cd plasmicpkgs/commerce-providers/elastic-path && yarn test

# MCP server tests (if needed)
cd packages/plasmic-mcp && npm test              # All tests (1,852 — unit + integration)
cd packages/plasmic-mcp && npm run test:unit      # Unit tests only (mocked WAB)
cd packages/plasmic-mcp && npm run typecheck      # TypeScript type checking (tsc --noEmit)
```

# Key Patterns

- Monorepo: platform/ (apps), packages/ (SDK), plasmicpkgs/ (code components)
- **EP Commerce components:** `plasmicpkgs/commerce-providers/elastic-path/src/`
- **Server-cart architecture (current focus):** `elastic-path/src/shopper-context/` (new directory)
- **Singleton context pattern to follow:** `elastic-path/src/bundle/composable/BundleContext.tsx`, `elastic-path/src/cart-drawer/CartDrawerContext.tsx`
- **Existing cart hooks (being replaced):** `elastic-path/src/cart/use-cart.tsx`, `use-add-item.tsx`, `use-remove-item.tsx`, `use-update-item.tsx`
- **Composable component examples:** `elastic-path/src/bundle/composable/`, `elastic-path/src/cart-drawer/`, `elastic-path/src/variant-picker/`
- **Existing hooks:** `elastic-path/src/product/use-search.tsx`, `use-product.tsx`; `elastic-path/src/site/use-categories.tsx`
- **Data normalization:** `elastic-path/src/utils/normalize.ts`
- **Mock data:** `elastic-path/src/utils/design-time-data.ts`
- **Registration:** `elastic-path/src/index.tsx` (registerAll function)
- **EP SDK:** `@epcc-sdk/sdks-shopper` — shopper client in `elastic-path/src/client.ts`
- **Catalog search adapter:** `@elasticpath/catalog-search-instantsearch-adapter` (external package to add as dependency)
- MCP server source: `packages/plasmic-mcp/src/`
- Plasmic registry package: `packages/plasmic-mcp-registry/`
- Use explicit `git add <files>` — never `git add -A` or `git add .`

# Composable Component Pattern

All new components follow the **headless Provider → Repeater** pattern:
- **Provider** component: fetches data, manages state, exposes via `DataProvider` + `refActions`
- **Repeater** component: uses `repeatedElement()` from `@plasmicapp/host`, exposes per-item data
- **No field/card components** — designer uses ANY Plasmic elements with data binding
- **Auto-wired defaults** — default slot content is pre-bound so components work immediately on drop
- All components expose `className`, `previewState`, and state slots (`loadingContent`, `errorContent`, `emptyContent`)
- Reference implementations: `EPBundleProvider`, `EPCartDrawer`, `EPVariationPicker`

# Upstream Merge Strategy

This is a fork that regularly pulls from upstream Plasmic. To minimize merge conflicts:

- **Prefer new files over modifying existing ones.** Put new functionality in its own module and import it where needed.
- **Keep changes to upstream files minimal.** Make the smallest possible change and put implementation in a new file.
- **New packages are free.** Adding `packages/plasmic-mcp/` creates zero merge conflicts.
- **Avoid reformatting or reorganising upstream files.** Even well-intentioned cleanups cause conflicts on the next merge.
