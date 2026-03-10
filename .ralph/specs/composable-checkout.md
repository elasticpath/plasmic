# Composable Checkout

## Overview
Composable checkout replaces the monolithic `EPCheckoutForm` and `EPPaymentForm` components with a Provider → slot architecture that gives designers full layout control while preserving all business logic in hooks and API routes that already exist. Each component is headless: it provides data via `DataProvider` and actions via `refActions`, with no forced markup, so the designer can wire any Plasmic element to any field. The 9 new components live entirely in `src/checkout/composable/` and register through the existing `registerCheckout()` barrel in `src/registerCheckout.tsx`.

## Dependencies
None expected — all new components use Stripe Elements (`@stripe/react-stripe-js` / `@stripe/stripe-js`) and the EP Shopper SDK which are already present, plus `@plasmicapp/host` APIs already used throughout the codebase.

---

## Phase 1: Core Checkout Provider (P0) — 4 Items

### Item 1.1: EPCheckoutProvider

**Purpose:** Root orchestrator for the entire checkout flow. Wraps `useCheckout()`, reads the cart ID from a cookie when not explicitly provided, exposes all checkout state as `checkoutData` to descendants, and wires actions that children can invoke via Plasmic interactions. Must function with or without `EPShopperContextProvider` in the tree.

**File:** `src/checkout/composable/EPCheckoutProvider.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Main checkout UI |
| `loadingContent` | slot | — | Shown while the cart is being fetched on mount |
| `errorContent` | slot | — | Shown when checkout enters an unrecoverable error state |
| `cartId` | string? | — | Explicit cart ID; falls back to `getCartId()` cookie helper |
| `apiBaseUrl` | string | `"/api"` | Base URL forwarded to `useCheckout()` |
| `autoAdvanceSteps` | boolean | `false` | When true, completing a step auto-advances to the next |
| `previewState` | choice | `"auto"` | `auto`, `customerInfo`, `shipping`, `payment`, `confirmation` |
| `className` | string? | — | |

**DataProvider key:** `checkoutData`

**Exposed data shape:**
```typescript
{
  // Navigation
  step: "customer_info" | "shipping" | "payment" | "confirmation"
  stepIndex: number            // 0-based (0–3)
  totalSteps: number           // 4
  canProceed: boolean          // mirrors useCheckout().canProceedToNext
  isProcessing: boolean        // true while any async action is running

  // Form data (present after each step is completed)
  customerInfo: {
    firstName: string
    lastName: string
    email: string
  } | null

  shippingAddress: AddressData | null
  billingAddress: AddressData | null
  sameAsShipping: boolean

  selectedShippingRate: {
    id: string
    name: string
    price: number
    priceFormatted: string
    currency: string
    estimatedDays?: string
    carrier?: string
  } | null

  // Order / payment (present after payment step)
  order: ElasticPathOrder | null
  paymentStatus: "idle" | "pending" | "processing" | "succeeded" | "failed"
  error: string | null

  // Convenience summary (mirrors checkoutCartData where possible)
  summary: {
    subtotal: number
    subtotalFormatted: string
    tax: number
    taxFormatted: string
    shipping: number
    shippingFormatted: string
    discount: number
    discountFormatted: string
    total: number
    totalFormatted: string
    currency: string
    itemCount: number
  }
}
```

**refActions:**
```typescript
nextStep()
previousStep()
goToStep(step: "customer_info" | "shipping" | "payment" | "confirmation")
submitCustomerInfo(data: {
  firstName: string; lastName: string; email: string;
  shippingAddress: AddressData; sameAsShipping: boolean;
  billingAddress?: AddressData;
})
submitShippingAddress(data: AddressData)
submitBillingAddress(data: AddressData)
selectShippingRate(rateId: string)
submitPayment()   // triggers createOrder → setupPayment → Stripe confirmPayment → confirmPayment
reset()
```

**Implementation notes:**
- Call `useCheckout({ cartId, apiBaseUrl, autoAdvanceSteps })` — the hook already manages the state machine.
- Read shopper auth from `useCommerce()` context if available (for authenticated cart ID fallback).
- `submitPayment()` action must be async: create order → setup payment → wait for Stripe → confirm with EP. Orchestrate by calling `useCheckout()` methods in sequence, storing `clientSecret` in local state for `EPPaymentElements` to consume via a nested context.
- Design-time: when `previewState !== "auto"` and in editor, expose full mock data matching each step so child components can be designed for every state.
- Render `loadingContent` slot when `state.isLoading` is true on mount (initial cart hydration).
- Render `errorContent` slot when `state.error` is set and no recovery is possible.
- Otherwise render `children`.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-checkout-provider"
displayName: "EP Checkout Provider"
providesData: true
refActions: { nextStep, previousStep, goToStep, submitCustomerInfo,
              submitShippingAddress, submitBillingAddress,
              selectShippingRate, submitPayment, reset }
```

**Design-time mock (`previewState` values):**
```typescript
// "customerInfo" preview
{
  step: "customer_info", stepIndex: 0, totalSteps: 4,
  canProceed: false, isProcessing: false,
  customerInfo: null, shippingAddress: null, billingAddress: null,
  sameAsShipping: true, selectedShippingRate: null,
  order: null, paymentStatus: "idle", error: null,
  summary: {
    subtotal: 6200, subtotalFormatted: "$62.00",
    tax: 496, taxFormatted: "$4.96",
    shipping: 0, shippingFormatted: "$0.00",
    discount: 0, discountFormatted: "$0.00",
    total: 6696, totalFormatted: "$66.96",
    currency: "USD", itemCount: 2
  }
}
// "shipping" preview — customerInfo filled, shippingAddress null
// "payment" preview — customerInfo + shippingAddress filled, selectedShippingRate present
// "confirmation" preview — all fields filled, order present
```

**Auto-wired default slot:**
```typescript
defaultValue: [
  {
    type: "component",
    name: "plasmic-commerce-ep-checkout-step-indicator"
  },
  {
    type: "component",
    name: "plasmic-commerce-ep-checkout-button"
  }
]
```

---

### Item 1.2: EPCheckoutStepIndicator

**Purpose:** Repeater over the 4 checkout steps. Each iteration receives a `currentStep` DataProvider so the designer can bind any element to step names, completion status, and active state. Zero rendering opinions — the designer controls all visual presentation.

**File:** `src/checkout/composable/EPCheckoutStepIndicator.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Repeated per step |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `withData` |

**DataProvider per iteration:** `currentStep`
```typescript
{
  name: string            // "Customer Info" | "Shipping" | "Payment" | "Confirmation"
  stepKey: string         // "customer_info" | "shipping" | "payment" | "confirmation"
  index: number           // 0–3
  isActive: boolean       // stepIndex === this index
  isCompleted: boolean    // stepIndex > this index
  isFuture: boolean       // stepIndex < this index
}
currentStepIndex: number  // second DataProvider for the iteration index itself
```

**Implementation notes:**
- Read `checkoutData.stepIndex` via `useSelector("checkoutData")`.
- The 4 steps are hardcoded: `[{ key: "customer_info", name: "Customer Info" }, { key: "shipping", name: "Shipping" }, { key: "payment", name: "Payment" }, { key: "confirmation", name: "Confirmation" }]`.
- Use `repeatedElement(i, children)` per step.
- Design-time mock: renders all 4 steps with stepIndex=1 (Shipping active, Customer Info completed).
- When no `checkoutData` context is found, default to `stepIndex=0`.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-checkout-step-indicator"
displayName: "EP Checkout Step Indicator"
providesData: true
parentComponentName: "plasmic-commerce-ep-checkout-provider"
```

**Auto-wired default slot:**
```typescript
defaultValue: [
  {
    type: "hbox",
    children: [
      { type: "text", value: "$currentStep.index + 1" },
      { type: "text", value: "$currentStep.name" }
    ]
  }
]
```

---

### Item 1.3: EPCheckoutButton

**Purpose:** A step-aware submit/advance button. Derives its label and behaviour from the current checkout step. On steps 0 (Customer Info) and 1 (Shipping), clicking calls `nextStep()`. On step 2 (Payment), clicking calls `submitPayment()`. On step 3 (Confirmation), clicking navigates away (fires `onComplete` event). The designer slots any content inside and styles freely.

**File:** `src/checkout/composable/EPCheckoutButton.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Button content (designer can use any elements) |
| `onComplete` | eventHandler | — | Fired on Confirmation step click; arg: `{ orderId: string }` |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `customerInfo`, `shipping`, `payment`, `confirmation` |

**DataProvider key:** `checkoutButtonData`
```typescript
{
  label: string           // "Continue to Shipping" | "Continue to Payment" | "Place Order" | "Done"
  isDisabled: boolean     // true while isProcessing or !canProceed
  isProcessing: boolean
  step: string            // mirrors checkoutData.step
}
```

**Step label mapping:**
| Step | Label |
|------|-------|
| `customer_info` | "Continue to Shipping" |
| `shipping` | "Continue to Payment" |
| `payment` | "Place Order" |
| `confirmation` | "Done" |

**onClick behaviour:**
- `customer_info` → calls `nextStep()` (no validation at this level — EPCustomerInfoFields validates independently)
- `shipping` → calls `nextStep()`
- `payment` → calls `submitPayment()` from `checkoutData` refActions
- `confirmation` → fires `onComplete({ orderId: checkoutData.order.id })`

**Implementation notes:**
- Read `checkoutData` via `useSelector("checkoutData")`.
- Button is `disabled` when `isDisabled` is true; shows spinner styling when `isProcessing` is true via `data-processing` attribute.
- In editor, always render as interactive (no disabled enforcement) so designers can style both states.
- Design-time mock: derive label from `previewState` value; `isDisabled=false`, `isProcessing=false`.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-checkout-button"
displayName: "EP Checkout Button"
providesData: true
```

**Auto-wired default slot:**
```typescript
defaultValue: [{ type: "text", value: "$checkoutButtonData.label" }]
```

---

### Item 1.4: EPOrderTotalsBreakdown

**Purpose:** Exposes line-item financial totals (subtotal, tax, shipping, discount, total) from the checkout context. Works alongside `EPCheckoutCartSummary` — reads from `checkoutData.summary` if inside `EPCheckoutProvider`, otherwise falls back to `checkoutCartData` from `EPCheckoutCartSummary`. Designer binds any elements to individual fields.

**File:** `src/checkout/composable/EPOrderTotalsBreakdown.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Layout for totals rows |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `withData` |

**DataProvider key:** `orderTotalsData`
```typescript
{
  subtotal: number
  subtotalFormatted: string     // "$62.00"
  tax: number
  taxFormatted: string          // "$4.96"
  shipping: number
  shippingFormatted: string     // "$5.95"
  discount: number
  discountFormatted: string     // "$0.00" (or "-$10.00" when promo applied)
  hasDiscount: boolean
  total: number
  totalFormatted: string        // "$72.91"
  currency: string              // "USD"
  itemCount: number
}
```

**Implementation notes:**
- Priority: `useSelector("checkoutData")?.summary` → `useSelector("checkoutCartData")` → design-time mock.
- When shipping rate not yet selected, `shipping` is 0 and `shippingFormatted` is `"TBD"`.
- When tax has not yet been calculated, `tax` is 0 and `taxFormatted` is `"Calculated at next step"`.
- Design-time mock matches `MOCK_CHECKOUT_CART_DATA` from `design-time-data.ts`, extended with `discount` fields.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-order-totals-breakdown"
displayName: "EP Order Totals Breakdown"
providesData: true
```

**Auto-wired default slot:**
```typescript
defaultValue: [
  {
    type: "vbox",
    children: [
      { type: "hbox", children: [
        { type: "text", value: "Subtotal" },
        { type: "text", value: "$orderTotalsData.subtotalFormatted" }
      ]},
      { type: "hbox", children: [
        { type: "text", value: "Shipping" },
        { type: "text", value: "$orderTotalsData.shippingFormatted" }
      ]},
      { type: "hbox", children: [
        { type: "text", value: "Tax" },
        { type: "text", value: "$orderTotalsData.taxFormatted" }
      ]},
      { type: "hbox", children: [
        { type: "text", value: "Total" },
        { type: "text", value: "$orderTotalsData.totalFormatted" }
      ]}
    ]
  }
]
```

---

## Phase 2: Form Fields (P1) — 3 Items

### Item 2.1: EPCustomerInfoFields

**Purpose:** Headless provider for customer identity fields (first name, last name, email). Exposes field values, validation errors, and touched state. Reads initial values from `EPShopperContextProvider` account profile when the shopper is authenticated. Designer places any input elements inside and binds their `value` and `onChange` interactions to the exposed refActions.

**File:** `src/checkout/composable/EPCustomerInfoFields.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Field inputs and labels |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `empty`, `filled`, `withErrors` |

**DataProvider key:** `customerInfoFieldsData`
```typescript
{
  firstName: string
  lastName: string
  email: string

  // Per-field validation errors (null when valid)
  errors: {
    firstName: string | null
    lastName: string | null
    email: string | null
  }

  // Whether field has been interacted with
  touched: {
    firstName: boolean
    lastName: boolean
    email: boolean
  }

  isValid: boolean         // all required fields pass validation
  isDirty: boolean         // any field modified from initial value
}
```

**refActions:**
```typescript
setField(name: "firstName" | "lastName" | "email", value: string)
validate()                // runs full form validation, marks all fields touched
clear()                   // resets all fields to empty
```

**Implementation notes:**
- Maintain field state in `useState`. On each `setField`, update value and clear the field's error if previously set.
- `validate()`: firstName and lastName are required (non-empty after trim); email must match a basic RFC 5322 pattern.
- On mount, if `useSelector("shopperContextData")` contains `account.name` and `account.email`, pre-populate fields (split name on first space into firstName/lastName).
- When `EPCheckoutProvider.submitCustomerInfo()` is called, `EPCheckoutButton` should trigger `validate()` first (via interaction chaining), then call `submitCustomerInfo` action with the current field values. This coordination happens in Plasmic Studio via interaction sequencing — this component does not call the parent action directly.
- Design-time `"withErrors"` mock: firstName empty + error "First name is required", email invalid + error "Enter a valid email address".
- Design-time `"filled"` mock: `{ firstName: "Jane", lastName: "Smith", email: "jane@example.com", errors: {…null}, touched: all true, isValid: true, isDirty: false }`.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-customer-info-fields"
displayName: "EP Customer Info Fields"
providesData: true
refActions: { setField, validate, clear }
```

**Auto-wired default slot:**
```typescript
defaultValue: [
  {
    type: "vbox",
    children: [
      { type: "hbox", children: [
        { type: "text", value: "First Name" },
        // Native input — designer replaces with styled component
      ]},
      { type: "hbox", children: [
        { type: "text", value: "Last Name" },
      ]},
      { type: "hbox", children: [
        { type: "text", value: "Email" },
      ]}
    ]
  }
]
```

---

### Item 2.2: EPShippingAddressFields

**Purpose:** Headless provider for shipping address fields. Exposes field values, errors, and address suggestions. Integrates with `validate-address` API endpoint for post-submission validation. Reads saved addresses from `EPShopperContextProvider` for pre-fill when the shopper is authenticated.

**File:** `src/checkout/composable/EPShippingAddressFields.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Address field inputs and labels |
| `showPhoneField` | boolean | `true` | Whether to expose/validate the phone field |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `empty`, `filled`, `withErrors`, `withSuggestions` |

**DataProvider key:** `shippingAddressFieldsData`
```typescript
{
  firstName: string
  lastName: string
  line1: string
  line2: string
  city: string
  county: string       // state/province
  postcode: string
  country: string      // 2-letter ISO code
  phone: string

  errors: {
    firstName: string | null
    lastName: string | null
    line1: string | null
    city: string | null
    postcode: string | null
    country: string | null
    phone: string | null   // only when showPhoneField is true
  }

  touched: Record<string, boolean>

  isValid: boolean
  isDirty: boolean

  // Set when validate-address API returns suggestions
  suggestions: Array<{
    line1: string
    city: string
    county: string
    postcode: string
    country: string
  }> | null
  hasSuggestions: boolean
}
```

**refActions:**
```typescript
setField(name: keyof AddressData, value: string)
validate()                         // client-side validation
clear()                            // resets all fields
useAccountAddress(addressId: string)  // copies a saved address into fields
```

**Implementation notes:**
- Required fields: `firstName`, `lastName`, `line1`, `city`, `postcode`, `country`.
- `phone` is required only when `showPhoneField` is true.
- `county` and `line2` are always optional.
- On country change, re-validate `postcode` pattern (US: 5-digit, CA: A1A 1A1 format, others: permissive).
- `useAccountAddress(addressId)`: look up `shopperContextData.addresses` array by ID and copy all fields. If shopper context is unavailable, no-op.
- Address suggestions come from the `validate-address` API route (`/api/checkout/validate-address`) — call on `validate()` when all required fields are present.
- Design-time `"filled"` mock: `{ firstName: "Jane", lastName: "Smith", line1: "123 Main St", city: "Portland", county: "OR", postcode: "97201", country: "US", phone: "555-0100", ... }`.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-shipping-address-fields"
displayName: "EP Shipping Address Fields"
providesData: true
refActions: { setField, validate, clear, useAccountAddress }
```

---

### Item 2.3: EPBillingAddressFields

**Purpose:** Headless provider for billing address fields. Follows the identical field structure as `EPShippingAddressFields`. When `checkoutData.sameAsShipping` is true, this component automatically mirrors the shipping address fields (reads from `shippingAddressFieldsData`) and exposes them as read-only. When `sameAsShipping` is false, fields are independently editable. Works in conjunction with the existing `EPBillingAddressToggle`.

**File:** `src/checkout/composable/EPBillingAddressFields.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Billing address field inputs |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `sameAsShipping`, `different`, `withErrors` |

**DataProvider key:** `billingAddressFieldsData`
```typescript
{
  // Same fields as shippingAddressFieldsData
  firstName: string
  lastName: string
  line1: string
  line2: string
  city: string
  county: string
  postcode: string
  country: string

  errors: Record<string, string | null>
  touched: Record<string, boolean>
  isValid: boolean
  isDirty: boolean

  // Billing-specific
  isMirroringShipping: boolean   // true when sameAsShipping is active
}
```

**refActions:**
```typescript
setField(name: keyof AddressData, value: string)
validate()
clear()
```

**Implementation notes:**
- Read `billingToggleData.isSameAsShipping` via `useSelector("billingToggleData")` from `EPBillingAddressToggle`.
- Also check `checkoutData.sameAsShipping` via `useSelector("checkoutData")` as a secondary source.
- When mirroring: read `shippingAddressFieldsData` via `useSelector("shippingAddressFieldsData")` and expose as `billingAddressFieldsData` with `isMirroringShipping: true`. Calls to `setField` are no-ops when mirroring.
- When not mirroring: maintain independent field state, identical validation logic to `EPShippingAddressFields`.
- Design-time `"sameAsShipping"` mock: shows all filled fields with `isMirroringShipping: true` from the shipping mock.
- Design-time `"different"` mock: independent address with Portland shipping / Seattle billing.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-billing-address-fields"
displayName: "EP Billing Address Fields"
providesData: true
refActions: { setField, validate, clear }
```

---

## Phase 3: Shipping & Payment (P2) — 2 Items

### Item 3.1: EPShippingMethodSelector

**Purpose:** Repeater over available shipping rates. Fetches rates from the `calculate-shipping` endpoint once the shipping address is complete. Each iteration provides a `currentShippingMethod` DataProvider. Selection action calls `selectShippingRate` on the parent checkout context.

**File:** `src/checkout/composable/EPShippingMethodSelector.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Repeated per shipping method |
| `loadingContent` | slot | — | Shown while fetching rates |
| `emptyContent` | slot | — | Shown when no rates available for the address |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `withRates`, `loading`, `empty` |

**DataProvider per iteration:** `currentShippingMethod`
```typescript
{
  id: string
  name: string               // "Standard Shipping"
  price: number              // raw cents/smallest currency unit
  priceFormatted: string     // "$5.95"
  estimatedDays: string      // "3-5 business days"
  carrier: string            // "UPS" | "USPS" | "FedEx" | ""
  isSelected: boolean
}
currentShippingMethodIndex: number
```

**refActions:**
```typescript
selectMethod(rateId: string)
```

**Implementation notes:**
- On mount (and whenever shipping address changes), check `useSelector("shippingAddressFieldsData")?.isValid`. If true, call `useCheckout().calculateShipping(shippingAddress)`.
- Store fetched rates in local state. Display `loadingContent` during fetch.
- `selectMethod(rateId)`: call `useCheckout().selectShippingRate(rate)` where `rate` is found in local rates array by id.
- Also call `selectShippingRate` refAction on `EPCheckoutProvider` so `checkoutData.selectedShippingRate` is updated.
- Design-time mock rates:
  ```typescript
  [
    { id: "std", name: "Standard Shipping", price: 595, priceFormatted: "$5.95", estimatedDays: "3-5 business days", carrier: "USPS", isSelected: false },
    { id: "exp", name: "Express Shipping", price: 1295, priceFormatted: "$12.95", estimatedDays: "1-2 business days", carrier: "UPS", isSelected: false },
    { id: "free", name: "Free Shipping", price: 0, priceFormatted: "FREE", estimatedDays: "5-7 business days", carrier: "", isSelected: true }
  ]
  ```
- Use `repeatedElement(i, children)` per rate.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-shipping-method-selector"
displayName: "EP Shipping Method Selector"
providesData: true
refActions: { selectMethod }
parentComponentName: "plasmic-commerce-ep-checkout-provider"
```

**Auto-wired default slot:**
```typescript
defaultValue: [
  {
    type: "hbox",
    children: [
      { type: "text", value: "$currentShippingMethod.name" },
      { type: "text", value: "$currentShippingMethod.estimatedDays" },
      { type: "text", value: "$currentShippingMethod.priceFormatted" }
    ]
  }
]
```

---

### Item 3.2: EPPaymentElements

**Purpose:** Composable Stripe Elements wrapper. Initialises the Stripe `<Elements>` provider with the `clientSecret` obtained from `EPCheckoutProvider`'s `submitPayment()` flow, renders the Stripe `<PaymentElement>` inside the designer's slot, and exposes payment readiness and error state via `paymentData`. At design-time, renders a static mock payment form preview so the designer can position and style the form without Stripe credentials.

**File:** `src/checkout/composable/EPPaymentElements.tsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | slot | — | Slot rendered inside the Stripe Elements provider (designer can add additional form fields alongside `<PaymentElement>`) |
| `stripePublishableKey` | string | — | Stripe `pk_live_*` or `pk_test_*` key |
| `appearance` | json | `{}` | Stripe Elements appearance object (theme, variables, rules) |
| `className` | string? | — | |
| `previewState` | choice | `"auto"` | `auto`, `ready`, `processing`, `error` |

**DataProvider key:** `paymentData`
```typescript
{
  isReady: boolean          // Stripe Elements mounted and ready for input
  isProcessing: boolean     // payment confirmation in flight
  error: string | null      // last Stripe or EP error message
  paymentMethodType: string // "card" | "sepa_debit" | etc., from PaymentElement
  clientSecret: string | null
}
```

**Implementation notes:**
- Read `clientSecret` from a checkout-scoped React context that `EPCheckoutProvider` sets after `setupPayment()` completes. This keeps Stripe initialisation inside `EPPaymentElements` while the secret is managed by the provider.
- Use `useStripePayment()` hook from `src/checkout/hooks/use-stripe-payment.tsx` to load Stripe and hold the Elements instance.
- When `clientSecret` is available: wrap children in `<Elements stripe={stripe} options={{ clientSecret, appearance, loader: "auto" }}>`. Render `<PaymentElement>` as a sibling to `children` inside the Elements context (so the designer can add a submit button or other fields alongside it).
- `EPCheckoutButton` calls `submitPayment()` on `EPCheckoutProvider`, which calls `stripe.confirmPayment({ elements })`. `EPPaymentElements` exposes `elements` to the provider via the same checkout-scoped context.
- Design-time: when `inEditor` is true, render a static mock form (grey input boxes labelled "Card number", "MM / YY", "CVC") to show approximate dimensions. Do not attempt to load Stripe in the editor.
- When `stripePublishableKey` is missing at runtime, set `paymentData.error` to `"Stripe publishable key is required"` and render `null` content.

**Registration metadata:**
```typescript
name: "plasmic-commerce-ep-payment-elements"
displayName: "EP Payment Elements"
providesData: true
```

**Auto-wired default slot:**
```typescript
defaultValue: [
  // Empty — the PaymentElement is rendered internally
  // Designer adds a submit button via EPCheckoutButton below this component
]
```

---

## Registration

All new components register through the existing `registerCheckout()` function in `src/registerCheckout.tsx`. Registration must follow leaf-first ordering (children before parents) consistent with the existing pattern.

| Component | Registration Name | Registration Function |
|-----------|------------------|-----------------------|
| EPCheckoutProvider | `plasmic-commerce-ep-checkout-provider` | `registerEPCheckoutProvider` |
| EPCheckoutStepIndicator | `plasmic-commerce-ep-checkout-step-indicator` | `registerEPCheckoutStepIndicator` |
| EPCheckoutButton | `plasmic-commerce-ep-checkout-button` | `registerEPCheckoutButton` |
| EPOrderTotalsBreakdown | `plasmic-commerce-ep-order-totals-breakdown` | `registerEPOrderTotalsBreakdown` |
| EPCustomerInfoFields | `plasmic-commerce-ep-customer-info-fields` | `registerEPCustomerInfoFields` |
| EPShippingAddressFields | `plasmic-commerce-ep-shipping-address-fields` | `registerEPShippingAddressFields` |
| EPBillingAddressFields | `plasmic-commerce-ep-billing-address-fields` | `registerEPBillingAddressFields` |
| EPShippingMethodSelector | `plasmic-commerce-ep-shipping-method-selector` | `registerEPShippingMethodSelector` |
| EPPaymentElements | `plasmic-commerce-ep-payment-elements` | `registerEPPaymentElements` |

**Changes to `src/registerCheckout.tsx`:**
- Import each `register*` function from its new file.
- Add calls inside `registerEPCheckout()` in leaf-first order: `EPOrderTotalsBreakdown` → `EPCheckoutButton` → `EPCheckoutStepIndicator` → `EPCustomerInfoFields` → `EPShippingAddressFields` → `EPBillingAddressFields` → `EPShippingMethodSelector` → `EPPaymentElements` → `EPCheckoutProvider`.
- Re-export each `register*` function and each `ep*Meta` object from the barrel, matching the existing pattern.

---

## Design-Time Data Additions

**Add to `src/utils/design-time-data.ts`:**

```typescript
// Checkout provider mock (shared across step previews)
export const MOCK_CHECKOUT_DATA_CUSTOMER_INFO = {
  step: "customer_info", stepIndex: 0, totalSteps: 4,
  canProceed: false, isProcessing: false,
  customerInfo: null, shippingAddress: null, billingAddress: null,
  sameAsShipping: true, selectedShippingRate: null,
  order: null, paymentStatus: "idle", error: null,
  summary: {
    subtotal: 6200, subtotalFormatted: "$62.00",
    tax: 496, taxFormatted: "$4.96",
    shipping: 0, shippingFormatted: "$0.00",
    discount: 0, discountFormatted: "$0.00",
    total: 6696, totalFormatted: "$66.96",
    currency: "USD", itemCount: 2
  }
};

export const MOCK_CHECKOUT_STEP_DATA = [
  { name: "Customer Info", stepKey: "customer_info", index: 0, isActive: false, isCompleted: true, isFuture: false },
  { name: "Shipping",      stepKey: "shipping",       index: 1, isActive: true,  isCompleted: false, isFuture: false },
  { name: "Payment",       stepKey: "payment",        index: 2, isActive: false, isCompleted: false, isFuture: true  },
  { name: "Confirmation",  stepKey: "confirmation",   index: 3, isActive: false, isCompleted: false, isFuture: true  }
];

export const MOCK_ORDER_TOTALS_DATA = {
  subtotal: 6200,  subtotalFormatted: "$62.00",
  tax: 496,        taxFormatted: "$4.96",
  shipping: 595,   shippingFormatted: "$5.95",
  discount: 0,     discountFormatted: "$0.00",
  hasDiscount: false,
  total: 7291,     totalFormatted: "$72.91",
  currency: "USD", itemCount: 2
};

export const MOCK_CUSTOMER_INFO_FILLED = {
  firstName: "Jane", lastName: "Smith", email: "jane@example.com",
  errors: { firstName: null, lastName: null, email: null },
  touched: { firstName: true, lastName: true, email: true },
  isValid: true, isDirty: false
};

export const MOCK_SHIPPING_ADDRESS_FILLED = {
  firstName: "Jane", lastName: "Smith",
  line1: "123 Main St", line2: "",
  city: "Portland", county: "OR", postcode: "97201", country: "US", phone: "555-0100",
  errors: { firstName: null, lastName: null, line1: null, city: null, postcode: null, country: null, phone: null },
  touched: { firstName: true, lastName: true, line1: true, city: true, postcode: true, country: true, phone: true },
  isValid: true, isDirty: false, suggestions: null, hasSuggestions: false
};

export const MOCK_SHIPPING_RATES = [
  { id: "free", name: "Free Shipping",     price: 0,    priceFormatted: "FREE",    estimatedDays: "5-7 business days", carrier: "",     isSelected: true  },
  { id: "std",  name: "Standard Shipping", price: 595,  priceFormatted: "$5.95",   estimatedDays: "3-5 business days", carrier: "USPS", isSelected: false },
  { id: "exp",  name: "Express Shipping",  price: 1295, priceFormatted: "$12.95",  estimatedDays: "1-2 business days", carrier: "UPS",  isSelected: false }
];
```

---

## New Files Summary

All files are new additions. No existing files are deleted.

| File | Description |
|------|-------------|
| `src/checkout/composable/EPCheckoutProvider.tsx` | Root checkout orchestrator, wraps useCheckout() |
| `src/checkout/composable/EPCheckoutStepIndicator.tsx` | 4-step repeater with per-step DataProvider |
| `src/checkout/composable/EPCheckoutButton.tsx` | Step-aware submit/advance button |
| `src/checkout/composable/EPOrderTotalsBreakdown.tsx` | Financial totals DataProvider |
| `src/checkout/composable/EPCustomerInfoFields.tsx` | Customer name/email field state + validation |
| `src/checkout/composable/EPShippingAddressFields.tsx` | Shipping address field state + validation |
| `src/checkout/composable/EPBillingAddressFields.tsx` | Billing address field state, mirrors shipping when toggled |
| `src/checkout/composable/EPShippingMethodSelector.tsx` | Shipping rates repeater with calculate-shipping fetch |
| `src/checkout/composable/EPPaymentElements.tsx` | Stripe Elements wrapper |

**Modified files (additions only, no breaking changes):**

| File | Change |
|------|--------|
| `src/registerCheckout.tsx` | Import and call 9 new `register*` functions; re-export metas |
| `src/utils/design-time-data.ts` | Append new mock constants (no modifications to existing exports) |

---

## Scenarios

### Full Checkout Page (Two-Column Stripe Layout)
- Left column: `EPCheckoutProvider` wrapping step-conditional content:
  - Step 0: `EPCustomerInfoFields` + `EPShippingAddressFields` + `EPBillingAddressToggle` + (conditional) `EPBillingAddressFields`
  - Step 1: `EPShippingMethodSelector`
  - Step 2: `EPPaymentElements`
  - Step 3: existing `EPCheckoutConfirmation`
- `EPCheckoutStepIndicator` at top of form area
- `EPCheckoutButton` at bottom of form area
- Right column: `EPCheckoutCartSummary` + `EPCheckoutCartItemList` + `EPOrderTotalsBreakdown` + `EPPromoCodeInput`

### Mobile Single-Column
- Same component hierarchy, designer restructures to single column via Plasmic layout
- `EPCheckoutCartSummary` with `collapsible: true` above the form
- `EPCheckoutButton` fixed at bottom via sticky positioning (designer sets CSS)

### Authenticated Shopper Fast Fill
- `EPShopperContextProvider` wraps entire checkout page
- `EPCustomerInfoFields` auto-populates from account profile on mount
- `EPShippingAddressFields` exposes `useAccountAddress` action — designer adds a "Use saved address" button wired to this action

---

## Acceptance Criteria

### Phase 1 (P0)
- [ ] `EPCheckoutProvider` wraps `useCheckout()` and exposes complete `checkoutData` via DataProvider
- [ ] `EPCheckoutProvider` exposes all 9 refActions callable from Plasmic interactions
- [ ] `EPCheckoutProvider` renders `loadingContent` while cart hydrates, `errorContent` on unrecoverable error
- [ ] `EPCheckoutProvider` works without `EPShopperContextProvider` in the tree
- [ ] `EPCheckoutStepIndicator` repeats children 4 times with correct `isActive`, `isCompleted`, `isFuture` per iteration
- [ ] `EPCheckoutButton` derives label from step and calls correct action per step
- [ ] `EPCheckoutButton` `isDisabled` reflects `!canProceed || isProcessing`
- [ ] `EPOrderTotalsBreakdown` reads from `checkoutData.summary` when inside `EPCheckoutProvider`
- [ ] `EPOrderTotalsBreakdown` falls back to `checkoutCartData` when used standalone inside `EPCheckoutCartSummary`
- [ ] All Phase 1 components have `previewState` prop with meaningful mock data for each state
- [ ] All Phase 1 components registered in `registerCheckout()` without breaking existing registrations

### Phase 2 (P1)
- [ ] `EPCustomerInfoFields` validates firstName, lastName (required), email (format)
- [ ] `EPCustomerInfoFields` auto-populates from `shopperContextData` account profile when available
- [ ] `EPShippingAddressFields` validates all required fields and calls `validate-address` API on `validate()`
- [ ] `EPShippingAddressFields` `useAccountAddress(id)` copies saved address fields from context
- [ ] `EPBillingAddressFields` mirrors `shippingAddressFieldsData` when `billingToggleData.isSameAsShipping` is true
- [ ] `EPBillingAddressFields` independently editable when `isSameAsShipping` is false
- [ ] All form field components expose `setField`, `validate`, `clear` refActions

### Phase 3 (P2)
- [ ] `EPShippingMethodSelector` fetches rates when `shippingAddressFieldsData.isValid` becomes true
- [ ] `EPShippingMethodSelector` repeats children per rate with `currentShippingMethod` DataProvider
- [ ] `EPShippingMethodSelector.selectMethod(rateId)` updates `checkoutData.selectedShippingRate`
- [ ] `EPPaymentElements` renders `<Elements>` with `clientSecret` obtained from checkout provider context
- [ ] `EPPaymentElements` renders static mock form in Plasmic editor (no Stripe load in editor)
- [ ] `EPPaymentElements` exposes `paymentData` with `isReady`, `isProcessing`, `error` fields
- [ ] `EPPaymentElements` exposes `elements` instance to `EPCheckoutProvider` for `confirmPayment` call

### General
- [ ] All 9 components have `className` prop for designer styling
- [ ] All 9 components have `data-ep-*` attribute on root element for CSS targeting
- [ ] No new npm dependencies added
- [ ] Existing composable components (`EPCheckoutCartSummary`, `EPPromoCodeInput`, etc.) continue to work unchanged
- [ ] Existing monolithic components (`EPCheckoutForm`, `EPPaymentForm`) remain registered and functional

---

## Edge Cases

| Scenario | Expected Behaviour |
|----------|-------------------|
| `EPCheckoutProvider` has no cart ID (no cookie, no prop) | Show `errorContent` with message "No active cart found" |
| `submitPayment()` called before shipping address is complete | `isDisabled` prevents it; if forced, action returns early with error |
| Stripe publishable key missing | `EPPaymentElements` sets `paymentData.error` and renders nothing; `EPCheckoutButton` stays disabled |
| Stripe `confirmPayment` returns error | `paymentData.error` set; `isProcessing` clears; designer shows error via data binding |
| Network error during `calculateShipping` | `EPShippingMethodSelector` shows `emptyContent`; `canProceed` stays false |
| Shopper navigates back from Shipping to Customer Info | `previousStep()` resets `canProceed` for the Shipping step |
| Shopper completes order then reloads page | Cart cookie is cleared; `EPCheckoutProvider` shows `errorContent` (empty cart) |
| `EPBillingAddressFields` used outside `EPBillingAddressToggle` | Falls back to `checkoutData.sameAsShipping`; if neither present, defaults to `isMirroringShipping: false` |
| `EPOrderTotalsBreakdown` used outside both providers | Uses design-time mock at all times; logs warning in non-production builds |
| `autoAdvanceSteps: true` — user wants to stay on a step | `goToStep()` refAction still works; autoAdvance only fires on submit completion |
| Address validation returns suggestions | `hasSuggestions: true`; designer binds a suggestions list component to `suggestions` array; user selects, `setField` fills each field |
| Multiple `EPShippingMethodSelector` instances | Each fetches independently; both call `selectShippingRate` on the shared checkout context — last call wins |

---

## Out of Scope

- Order history / account order tracking (separate feature)
- Guest vs. authenticated checkout branching logic beyond address pre-fill
- Multi-address shipping (ship to multiple addresses)
- Gift wrapping / gift message fields
- Store pickup / click-and-collect shipping methods
- 3D Secure / additional Stripe payment method types beyond `PaymentElement` defaults
- Tax calculation UI before the payment step (shown as "Calculated at next step")
- Cart editing (quantity change, item removal) from within checkout — use existing cart components
- `EPCheckoutConfirmation` replacement — existing monolithic component remains in use for the confirmation step
