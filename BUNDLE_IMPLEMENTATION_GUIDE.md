# Elastic Path Bundle Implementation Guide

## Overview

This document provides a comprehensive guide for implementing Elastic Path bundle features in the Plasmic commerce provider. It details the current implementation status, missing features, and provides guidance for future development.

## 🎉 Implementation Status Summary

**Current Progress**: **Major milestone reached!** All core bundle features have been successfully implemented.

### Key Achievements:
- ✅ **Bundle Configuration**: Complete API integration with real-time price updates
- ✅ **Component Selection**: Full UI with validation, sorting, and quantity controls  
- ✅ **Parent Product Support**: Individual variation dropdowns with matrix navigation
- ✅ **Cart Integration**: EP-specific add to cart with bundle configuration
- ✅ **BigInt Issues**: Resolved serialization problems with EP SDK
- ✅ **Product Details**: Rich option display with names, prices, and metadata

### Remaining Work:
- 🔄 **Bundle of Bundles** (Low priority - specialized use case)
- 🔄 **Advanced UI Enhancements** (Optional - better UX)
- 🔄 **Performance Optimizations** (Optional - scaling improvements)

## Current Implementation Status

### ✅ Completed Features

1. **Basic Bundle Configuration**
   - Bundle component detection using `meta.product_types[0] === "bundle"`
   - Bundle configuration API integration (`configureByContextProduct`)
   - Real-time price updates from configured bundle response
   - BigInt serialization issue resolved

2. **Component Selection UI**
   - Dynamic component rendering with min/max validation
   - Radio buttons for single-select components (min=max=1)
   - Checkboxes for multi-select components
   - Optional component indicators
   - Sort order support for components and options

3. **Selection Logic**
   - Automatic selection of required components with default option support
   - Max=1 constraint enforcement (auto-replacement)
   - Component-level min/max validation
   - User-friendly validation messages
   - Default option selection (respects `default: true` flag)

4. **Option-Level Features**
   - Option-level quantity controls with min/max support
   - Variable quantity inputs for options with quantity ranges
   - Default quantity handling

5. **State Management**
   - Bundle configuration persistence in form state
   - URL parameter support for configuration sharing
   - Proper BigInt to number conversion for EP SDK
   - Form state integration with React Hook Form

6. **Cart Integration**
   - EP-specific Add to Cart button with bundle configuration support
   - Bundle configuration passed to cart API via extended cart item interface
   - Separation of concerns (EP-specific vs general commerce implementation)

7. **Parent Product Support** ⭐ **NEW**
   - Detection of parent products in bundle components
   - Fetching child products/variations for parent options
   - Individual variation dropdown selectors (like EP variant picker)
   - Variation matrix navigation to find matching child products
   - Support for excluded variations in bundles
   - Parent product option UI with variation selection

8. **Product Details Integration**
   - Option product fetching and display
   - Product names, prices, and metadata in option labels
   - Loading states for product information
   - Fixed vs cumulative pricing detection and display

### 📁 Key Files

- `/src/registerEPBundleConfigurator.tsx` - Main bundle configurator component with parent product support
- `/src/registerEPAddToCartButton.tsx` - EP-specific add to cart button with bundle support
- `/src/bundle/types.ts` - TypeScript types for bundles
- `/src/bundle/use-bundle-configuration.tsx` - Bundle configuration API hook
- `/src/bundle/use-bundle-validation.tsx` - Validation logic
- `/src/bundle/use-bundle-option-products.tsx` - Hook to fetch product details for options
- `/src/bundle/use-parent-products.tsx` - Hook to detect and fetch parent product variations
- `/src/cart/use-add-item.tsx` - Cart integration with bundle support

## Missing Features & Implementation Guide

### 1. ✅ ~~Option-Level Quantity Controls~~ (COMPLETED)

**Status**: ✅ **COMPLETED** - Option-level quantity controls with min/max support are now implemented

### 2. ✅ ~~Default Option Selection~~ (COMPLETED)

**Status**: ✅ **COMPLETED** - Default option selection respecting `default: true` flag is implemented

### 3. ✅ ~~Sort Order Support~~ (COMPLETED)

**Status**: ✅ **COMPLETED** - Components and options are now sorted by `sort_order` field

### 4. ✅ ~~Option Product Details~~ (COMPLETED)

**Status**: ✅ **COMPLETED** - Product names, prices, and metadata are displayed in option labels via `useBundleOptionProducts` hook

### 5. ✅ ~~Enhanced Price Display~~ (COMPLETED)

**Status**: ✅ **COMPLETED** - Fixed vs cumulative pricing detection and individual option price display implemented

### 6. ✅ ~~Parent Product Support~~ (COMPLETED)

**Status**: ✅ **COMPLETED** - Full parent product support with individual variation dropdowns implemented

#### What was implemented:
- Detection of parent products in bundle components
- Fetching child products/variations using `getByContextChildProducts`
- Individual variation dropdown selectors (similar to EP variant picker)
- Variation matrix navigation to find matching child products
- Support for excluded variations in bundles
- Parent product option UI with variation selection
- Proper handling of variation combinations

### 7. ✅ ~~Bundle Cart Integration~~ (COMPLETED)

**Status**: ✅ **COMPLETED** - EP-specific Add to Cart button with bundle configuration support

## Remaining Features to Implement

### 1. Bundle of Bundles (Priority: Low)

**Current State**: Not supported
**Required**: Options can be other bundles

#### Key Points:
- Parent bundle cannot be added to cart
- Each child bundle must be configured separately
- Used for grouping related bundles

#### Implementation:
1. Check option type for bundles
2. Add special UI for bundle options
3. Prevent parent bundle cart addition
4. Link to child bundle configurators

## Data Model Reference

### Bundle Structure
```typescript
// Bundle product from EP API
{
  id: "bundle-123",
  type: "product",
  attributes: {
    name: "Coffee Bundle",
    sku: "COFFEE-BUNDLE", // Present for fixed-price bundles
    components: {
      "size": {
        name: "Size",
        min: 1,
        max: 1,
        sort_order: 1,
        options: [
          {
            id: "prod-small",
            type: "product",
            quantity: 1,
            default: true,
            sort_order: 1
          },
          {
            id: "prod-large",
            type: "product", 
            quantity: 1,
            min: 1,
            max: 2,  // Can order 1-2 of this option
            sort_order: 2
          }
        ]
      }
    }
  },
  meta: {
    product_types: ["bundle"],
    bundle_configuration: {
      selected_options: {
        "size": {
          "prod-small": 1  // BigInt in actual response
        }
      }
    }
  }
}
```

### Bundle Configuration for Cart
```typescript
// Add to cart with bundle configuration
{
  type: "cart_item",
  id: "bundle-123",
  quantity: 1,
  bundle_configuration: {
    selected_options: {
      "size": {
        "prod-small": 1
      },
      "extras": {
        "prod-syrup": 2
      }
    }
  }
}
```

## Testing Considerations

### Test Scenarios:
1. **Component Validation**
   - Required components with no selection
   - Exceeding max selections
   - Below min selections

2. **Option Quantities**
   - Min/max quantity bounds
   - Default quantities
   - Quantity validation

3. **Pricing**
   - Fixed vs cumulative pricing
   - Price updates on selection change
   - Bundle vs individual pricing

4. **Complex Bundles**
   - Multiple components
   - Mixed optional/required
   - Parent products as options
   - Bundle of bundles

### Edge Cases:
- Components with no options
- Options with no IDs
- Invalid configurations from URL
- BigInt handling throughout
- Null/undefined handling for all optional fields

## API Integration Notes

### Configure Bundle Endpoint
```typescript
// POST /catalog/products/{product_id}/configure
const response = await configureByContextProduct({
  client: epClient,
  path: { product_id: bundleId },
  body: {
    data: {
      selected_options: {
        // Component key -> option ID -> quantity
        "size": { "prod-123": 1 },
        "milk": { "prod-456": 1 }
      }
    }
  }
});
```

### Important Notes:
- API expects BigInt for quantities but SDK can't serialize them
- Pass numbers, SDK should handle conversion
- Response includes updated price and configuration
- 404 errors may indicate catalog/context issues

## ✅ Completed Refactoring: Zod Schema Implementation

### Previous Problems with Manual Validation (Now Resolved):
1. ~~Duplicated validation logic in multiple places~~ ✅ Single schema source of truth
2. ~~Complex conditional logic for error messages~~ ✅ Declarative error messages in schema
3. ~~No compile-time type safety for form data~~ ✅ Full TypeScript inference via Zod
4. ~~Manual handling of default values and initialization~~ ✅ Automated with `createBundleDefaultValues`
5. ~~Scattered validation rules across components~~ ✅ Centralized in bundle schema

### Implemented Zod-Based Solution:

The bundle configurator now uses a fully type-safe Zod schema system with React Hook Form integration. This provides real-time validation, better error messages, and improved maintainability.

#### 1. Dynamic Bundle Schema Generation (✅ Implemented)
**File**: `/src/bundle/schemas/bundleSchema.ts`

```typescript
// Actual implementation
import { z } from 'zod';
import { ComponentProduct, ComponentProductOption } from './types';

export function createBundleSchema(components: Record<string, ComponentProduct>) {
  const componentSchemas: Record<string, z.ZodSchema> = {};

  Object.entries(components).forEach(([componentKey, component]) => {
    const min = component.min ?? 0;
    const max = component.max ?? Number.MAX_SAFE_INTEGER;
    const componentName = component.name || componentKey;

    // Create schema for option selections
    let optionSchema = z.record(
      z.string(), // option ID
      z.number().min(1) // quantity
    );

    // Add component-level validation
    optionSchema = optionSchema
      .refine(
        (options) => {
          const totalCount = Object.values(options).reduce((sum, qty) => sum + qty, 0);
          return totalCount >= min;
        },
        {
          message: min === 1 
            ? `Please select one option for ${componentName}`
            : `Please select at least ${min} options for ${componentName}`
        }
      )
      .refine(
        (options) => {
          const totalCount = Object.values(options).reduce((sum, qty) => sum + qty, 0);
          return totalCount <= max;
        },
        {
          message: `Maximum ${max} selections allowed for ${componentName}`
        }
      );

    // Handle optional components
    componentSchemas[componentKey] = min === 0 
      ? optionSchema.optional().default({})
      : optionSchema;
  });

  return z.object(componentSchemas);
}

// Option-level quantity schema (for future implementation)
export function createOptionQuantitySchema(option: ComponentProductOption) {
  const min = option.min ?? 1;
  const max = option.max ?? option.quantity ?? 1;
  
  return z.number()
    .min(min, `Minimum ${min} required`)
    .max(max, `Maximum ${max} allowed`);
}
```

#### 2. React Hook Form Integration (✅ Implemented)
**File**: `/src/bundle/hooks/useBundleForm.tsx`

The bundle configurator now uses its own React Hook Form instance with Zod resolver, maintaining independence from the parent form context while syncing necessary data back for cart integration.

```typescript
// Actual implementation with key features:
export function useBundleForm({
  components,
  bundleProduct,
  defaultConfiguration,
  onSubmit,
}: UseBundleFormProps): UseBundleFormReturn {
  // Dynamic schema based on components
  const bundleSchema = useMemo(
    () => createBundleSchema(components),
    [components]
  );

  // Form with Zod resolver
  const form = useForm<BundleFormData>({
    resolver: zodResolver(bundleSchema),
    defaultValues: createBundleDefaultValues(components, bundleProduct, defaultConfiguration),
    mode: 'onChange', // Real-time validation
  });

  // Handles component selection with proper validation
  const handleComponentSelection = useCallback(...);

  return {
    form,
    selectedOptions,
    isValid,
    errors,
    handleComponentSelection,
    handleSubmit,
    reset,
  };
}
```

#### 3. Simplified Default Value Logic
```typescript
function getDefaultValues(
  components: Record<string, ComponentProduct>,
  bundleProduct?: ElasticPathBundleProduct
): Record<string, Record<string, number>> {
  const defaults: Record<string, Record<string, number>> = {};
  
  // Load from API configuration
  if (bundleProduct?.meta?.bundle_configuration?.selected_options) {
    // Convert BigInt to numbers
    Object.entries(bundleProduct.meta.bundle_configuration.selected_options)
      .forEach(([key, options]) => {
        defaults[key] = Object.fromEntries(
          Object.entries(options).map(([id, qty]) => [id, Number(qty)])
        );
      });
  }
  
  // Ensure required components have selections
  Object.entries(components).forEach(([key, component]) => {
    if (component.min && component.min > 0 && !defaults[key]) {
      const defaultOption = component.options?.find(o => o.default) 
        || component.options?.[0];
      
      if (defaultOption?.id) {
        defaults[key] = { 
          [defaultOption.id]: defaultOption.quantity || 1 
        };
      }
    }
  });
  
  return defaults;
}
```

#### 4. Benefits of Zod Approach:

1. **Type Safety**: Full TypeScript inference for form data
2. **Single Source of Truth**: All validation rules in the schema
3. **Better Error UX**: Consistent, customizable error messages
4. **Less Code**: Eliminate manual validation logic
5. **Easier Testing**: Schemas can be unit tested independently
6. **Extensibility**: Easy to add new validation rules
7. **Performance**: React Hook Form optimizes re-renders

#### 5. Advanced Features:

```typescript
// Cross-component validation
const bundleSchema = createBundleSchema(components).refine(
  (data) => {
    // Example: Validate component combinations
    const hasMilk = data.milk && Object.keys(data.milk).length > 0;
    const hasDecaf = data.blend?.['decaf'];
    return !(hasMilk && hasDecaf); // No milk with decaf
  },
  { 
    message: "Decaf options cannot be combined with milk selections",
    path: ['milk'] // Show error on milk component
  }
);

// Transform data for API
const apiSchema = bundleSchema.transform((data) => ({
  selected_options: data // Already in correct format
}));
```

## Future Enhancements

1. **Advanced UI Components**
   - Image galleries for options
   - Accordion/tab layouts for components
   - Progress indicators for multi-step bundles

2. **Performance Optimizations**
   - Cache option product details
   - Batch fetch product information
   - Debounce configuration API calls (already implemented)

3. **Enhanced Validation**
   - Real-time stock checking
   - Price threshold warnings
   - Compatibility checking between options

4. **Analytics Integration**
   - Track bundle configuration events
   - Monitor popular combinations
   - Conversion tracking by bundle type

## References

- [Elastic Path Bundle Documentation](https://documentation.elasticpath.com/commerce-cloud/docs/api/catalog/bundles)
- [Bundle Configuration API](https://documentation.elasticpath.com/commerce-cloud/docs/api/pxm/catalog/by-context/configure-by-context-product)
- [Add Bundle to Cart](https://documentation.elasticpath.com/commerce-cloud/docs/api/carts/manage-carts)