# Bundle Hooks Rework

## Jobs to Be Done
- As a Plasmic designer, I want the bundle hooks to use the same SWR caching pattern (`useMutablePlasmicQueryData`) as locations and stock so that bundle data fetching is cached, deduplicated, and consistent with the rest of the package
- As a developer, I want the bundle hooks to be clean, testable, and free of legacy patterns so that the composable components have a solid foundation

## Current State

The existing bundle hooks were written for the monolithic `EPBundleConfigurator` and have several issues:

1. **`useBundleOptionProducts`** — fetches all option products via `getByContextAllProducts` using raw `useEffect`/`useState` (no caching)
2. **`useParentProducts`** — fetches child products for parent options via `getByContextChildProducts` using raw `useEffect`/`useState` (no caching)
3. **`useBundleConfiguration`** — calls `configureByContextProduct` API, also raw `useEffect`/`useState`
4. **`useBundleConfigurationOrchestration`** — debounce + deduplication layer on top of `useBundleConfiguration`, uses custom comparison logic
5. **`useBundleForm`** — react-hook-form + Zod, manages selections. Well-structured but tightly coupled to the monolithic component's rendering assumptions
6. **`useBundleFormSync`** — syncs to parent form context and URL. Depends on internal form structure
7. **`useBundleState`** — appears partially superseded by `useBundleForm`, unclear usage
8. **`useVariationSelection`** — manages variation axis selections for parent products. Works but isolated to one component

## Acceptance Criteria

### Caching
- [ ] Product fetching hooks (`useBundleOptionProducts`, `useParentProducts`) use `useMutablePlasmicQueryData` for SWR-style caching and deduplication
- [ ] Stable query keys based on bundle product ID and component option IDs
- [ ] `revalidateOnFocus: false` with appropriate `dedupingInterval`

### Hook Consolidation
- [ ] Evaluate whether `useBundleState` is still needed or can be removed in favour of `useBundleForm`
- [ ] `useBundleForm` API is clean enough for composable components to consume (returns selections, handlers, validation state)
- [ ] `useBundleConfigurationOrchestration` continues to debounce and deduplicate API calls but uses cleaner state management
- [ ] `useBundleFormSync` continues to write `BundleConfiguration` and `ConfiguredBundleId` to parent react-hook-form context

### Variation Selection
- [ ] `useVariationSelection` is refactored to be reusable by the new `EPBundleVariationPicker` component
- [ ] Child variant resolution (via `findMatchingVariant`) continues to work with the variation matrix
- [ ] Selected child variant ID is properly formatted as `parentId:childId` key in bundle selections

### Testing
- [ ] Existing tests in `bundle/hooks/__tests__/` and `bundle/utils/__tests__/` continue to pass
- [ ] New tests added for any refactored hook interfaces

### Utilities Preserved
- [ ] `bundleSelectionUtils.ts` — `sortByOrder`, `convertSelectionsForAPI`, `areSelectionsEqual`, `getDefaultSelections` — unchanged or minimally modified
- [ ] `priceCalculation.ts` — `calculateBundlePrice`, `formatPriceDisplay` — unchanged
- [ ] `productValidation.ts` — `validateBundleProduct`, `getBundlePricingType` — unchanged
- [ ] `configurationComparison.ts` — unchanged
- [ ] `variationMatching.ts` — `findMatchingVariant` — unchanged
- [ ] `bundleSchema.ts` — Zod schema generation — unchanged

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Multiple bundle products on same page | SWR keys scoped by product ID prevent cross-contamination |
| Option products already cached from a previous visit | SWR returns cached data immediately, revalidates in background |
| Parent product's child products change (rare) | Cache expires after `dedupingInterval`, fresh data fetched |
| `configureByContextProduct` called rapidly | Orchestration hook debounces, only sends the latest selection |
| Form state restored from URL param | Hooks initialize with URL-derived defaults before any API call |

## Out of Scope

- Changing the EP API contract (the SDK calls remain the same)
- Modifying `cartDataBuilder.ts` bundle integration (already works)
- Changes to `normalize.ts` for bundle product display
