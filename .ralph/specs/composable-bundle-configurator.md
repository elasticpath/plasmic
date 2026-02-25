# Composable Bundle Configurator

## Jobs to Be Done
- As a Plasmic designer, I want to build a fully custom bundle configuration UI so that I can control every aspect of the layout, styling, and field display without writing code
- As a Plasmic designer, I want composable bundle components that follow the same DataProvider/useSelector pattern as the existing variant picker, stock, and cart drawer components so that the mental model is consistent

## Component Tree

The composable bundle follows the same hierarchical pattern as `EPVariationPicker`:

```
EPBundleProvider                    (root — reads currentProduct, orchestrates bundle state)
  ├── EPBundlePriceField            (leaf — displays bundle price info)
  ├── EPBundleValidationErrors      (leaf — renders validation error messages)
  └── EPBundleComponentList         (iterator — repeats per bundle component)
        ├── EPBundleComponentField  (leaf — displays component name, min, max, etc.)
        └── EPBundleOptionList      (iterator — repeats per option in the component)
              ├── EPBundleOptionField         (leaf — displays option product name, price, etc.)
              ├── EPBundleOptionTrigger       (interactive — selects/deselects the option)
              ├── EPBundleOptionQuantityControl  (composable — manages option quantity)
              │     └── EPBundleOptionQuantityButton  (interactive — increment/decrement)
              └── EPBundleVariationPicker     (composable — for parent product options)
                    └── EPBundleVariationOptionList  (iterator — per variation axis)
                          ├── EPBundleVariationField        (leaf — variation axis name)
                          └── EPBundleVariationOptionTrigger (interactive — select variation value)
```

## DataProvider Keys

Each component level provides data to its descendants:

| Component | DataProvider name | Data shape |
|---|---|---|
| EPBundleProvider | `bundleData` | `{ isValid, errors[], pricingType, currentPrice, isConfiguring, componentCount }` |
| EPBundleComponentList | `currentBundleComponent` | `{ name, key, min, max, selectedCount, isValid, options[], sortOrder }` |
| EPBundleComponentList | `currentBundleComponentIndex` | `number` |
| EPBundleOptionList | `currentBundleOption` | `{ id, name, quantity, minQty, maxQty, isSelected, isParentProduct, price, imageUrl, sortOrder, isDefault }` |
| EPBundleOptionList | `currentBundleOptionIndex` | `number` |
| EPBundleOptionQuantityControl | `bundleOptionQuantity` | `{ quantity, isLoading, canDecrement, canIncrement, min, max }` |
| EPBundleVariationPicker | `currentBundleVariation` | `{ id, name, values: { label }[] }` |
| EPBundleVariationPicker | `currentBundleVariationIndex` | `number` |
| EPBundleVariationOptionList | `currentBundleVariationOption` | `{ label, isSelected }` |
| EPBundleVariationOptionList | `currentBundleVariationOptionIndex` | `number` |

## React Context (for imperative actions)

Following the pattern of `CartItemQuantityContext` and `VariationPickerContext`:

| Context | Provider | Consumer | Interface |
|---|---|---|---|
| `BundleOptionContext` | `EPBundleOptionTrigger` or `EPBundleOptionList` | `EPBundleOptionTrigger`, `EPBundleOptionQuantityButton` | `{ toggleOption(), setQuantity(n), isSelected }` |
| `BundleVariationContext` | `EPBundleVariationPicker` | `EPBundleVariationOptionTrigger` | `{ selectedValues, selectVariation(axisId, value) }` |

## Acceptance Criteria

### Provider & State
- [x] EPBundleProvider reads `currentProduct` from ancestor Product Box via `useSelector`
- [x] EPBundleProvider validates the product is a bundle and extracts components
- [x] EPBundleProvider manages bundle form state (selected options, quantities)
- [x] EPBundleProvider orchestrates debounced EP `configureByContextProduct` API calls
- [x] EPBundleProvider writes `BundleConfiguration` and `ConfiguredBundleId` to parent react-hook-form context (for EPAddToCartButton integration)
- [x] EPBundleProvider syncs state to/from URL params when `updateUrlOnChange` is true
- [x] EPBundleProvider restores default configuration from: URL param > API config > auto-select defaults (in priority order)

### Component List
- [x] EPBundleComponentList iterates over bundle components sorted by `sort_order`
- [x] EPBundleComponentField displays: `name`, `min`, `max`, `selectedCount`, `isValid`

### Option List & Selection
- [x] EPBundleOptionList iterates over options within the current component
- [x] EPBundleOptionField displays: `name`, `price`, `imageUrl`, `isSelected`, `quantity`
- [x] EPBundleOptionTrigger toggles option selection on click (checkbox-like for multi-select, radio-like for single-select components)
- [x] EPBundleOptionTrigger exposes `data-selected` attribute for CSS styling
- [x] EPBundleOptionTrigger uses `role="checkbox"` or `role="radio"` with `aria-checked` based on component min/max (single vs multi-select)

### Quantity Controls
- [x] EPBundleOptionQuantityControl manages quantity state for the current option
- [x] EPBundleOptionQuantityControl respects option-level `min` and `max` constraints
- [x] EPBundleOptionQuantityButton increments/decrements via React Context
- [x] Quantity changes trigger bundle reconfiguration (debounced)

### Parent Product Variations
- [x] EPBundleVariationPicker detects when a bundle option is a parent product and fetches child products
- [x] EPBundleVariationPicker iterates over variation axes of the parent product
- [x] EPBundleVariationOptionList iterates over values for each variation axis
- [x] EPBundleVariationOptionTrigger selects a variation value and resolves the matching child variant
- [x] Selected child variant ID replaces the parent ID in the bundle selection (using `parentId:childId` key format)

### Price
- [x] EPBundlePriceField displays the current bundle price
- [x] EPBundlePriceField handles both fixed and cumulative pricing types
- [x] Price updates after each successful `configureByContextProduct` call

### Validation
- [x] EPBundleValidationErrors renders current validation errors
- [x] Validation uses Zod schema generated from component min/max and option min/max constraints
- [x] Validation runs on every selection change (client-side, no API call)

### Design-Time Preview
- [x] Every component has a `previewState` prop for design-time editing in Plasmic Studio
- [x] Mock data in `design-time-data.ts` covers: multi-component bundle, single-select component, multi-select component, parent product with variations, fixed pricing, cumulative pricing

### Registration
- [x] All components registered via `register*` functions following existing pattern
- [x] All components registered in `registerAll()` in `index.tsx`
- [x] Each component has `providesData: true` where applicable
- [x] Meta objects include accurate `parentComponentName` hints for Plasmic Studio nesting guidance

## Happy Path

1. Designer drags `EPBundleProvider` onto a product page (inside a Product Box that provides `currentProduct`)
2. EPBundleProvider detects the product is a bundle, fetches option products, and exposes `bundleData`
3. Designer places `EPBundleComponentList` inside the provider with a template containing `EPBundleComponentField` (for section headers) and `EPBundleOptionList`
4. Inside `EPBundleOptionList`, designer arranges `EPBundleOptionField` (product name/price), `EPBundleOptionTrigger` (selection), and optionally `EPBundleOptionQuantityControl` with `EPBundleOptionQuantityButton` children
5. For parent product options, designer nests `EPBundleVariationPicker` inside the option template with `EPBundleVariationOptionList` and `EPBundleVariationOptionTrigger`
6. Designer places `EPBundlePriceField` and `EPBundleValidationErrors` wherever they want in the layout
7. Selections flow through to `BundleConfiguration` on the react-hook-form context
8. EPAddToCartButton reads `BundleConfiguration` from the form and includes it in the cart add request
9. All styling is controlled entirely by the designer through Plasmic Studio

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| Product is not a bundle | EPBundleProvider renders nothing (or `emptyContent` slot) |
| Bundle has no components | EPBundleProvider renders nothing (or `emptyContent` slot) |
| Component requires exactly 1 option (min=1, max=1) | EPBundleOptionTrigger acts as radio buttons (only one selected at a time) |
| Component allows multiple options (min=0, max=N) | EPBundleOptionTrigger acts as checkboxes |
| Option has quantity min=1, max=5 | EPBundleOptionQuantityControl enforces range, buttons disable at limits |
| Option has no quantity range (min=null, max=null) | Quantity defaults to option's `quantity` value, no quantity control shown |
| All options in a required component are deselected | Validation error shown via EPBundleValidationErrors |
| Default configuration exists on the bundle | Selections pre-populated on mount before any user interaction |
| URL contains `?bundle=` base64 config | URL config takes priority over API defaults |
| Parent product option selected but no variation chosen | Validation blocks — child variant must be resolved |
| API `configureByContextProduct` call fails | Error exposed in `bundleData`, EPBundleValidationErrors can show it |
| API call in flight (debounced) | `bundleData.isConfiguring` is true, components can show loading state |
| Fixed-price bundle | EPBundlePriceField shows the bundle's SKU price, not sum of options |
| Cumulative-price bundle | EPBundlePriceField shows sum of selected option prices |
| Designer previewing in Plasmic Studio (no live store) | `previewState` on each component shows realistic mock data |

## Out of Scope

- Removing or deprecating the existing monolithic `EPBundleConfigurator` — keep it registered for backwards compatibility
- Bundle item display in cart drawer (showing sub-items of a bundle in the cart) — separate feature
- Nested bundles (bundles containing other bundles)
- Bundle inventory/stock checking at the option level
