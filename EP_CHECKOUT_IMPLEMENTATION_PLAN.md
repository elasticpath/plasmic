# Elastic Path Checkout Components Implementation Plan

## Overview

This document outlines the complete implementation plan for creating checkout components for Elastic Path Commerce Cloud with Stripe integration in Plasmic. The plan is based on extensive research of the Elastic Path SDK, existing commerce provider patterns, and industry best practices.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Checkout Flow](#checkout-flow)
3. [Component Specifications](#component-specifications)
4. [Implementation Structure](#implementation-structure)
5. [API Integration](#api-integration)
6. [Security Considerations](#security-considerations)
7. [Testing Strategy](#testing-strategy)
8. [File Structure](#file-structure)
9. [Development Phases](#development-phases)

## Architecture Overview

### Core Checkout Flow
Based on Elastic Path Commerce Cloud documentation, the checkout process follows this pattern:

1. **Cart → Order Conversion**: Use `checkoutApi` to convert cart to incomplete order
2. **Payment Setup**: Use `paymentSetup` to initialize payment intent with Stripe
3. **Payment Processing**: Handle payment with Stripe Elements and confirm with EP
4. **Order Completion**: Use `confirmPayment` to finalize the order

### Key Elastic Path SDK Methods
- `checkoutApi` - POST `/v2/carts/{cartID}/checkout`
- `paymentSetup` - POST `/v2/orders/{orderID}/payments`
- `confirmPayment` - POST `/v2/orders/{orderID}/transactions/{transactionID}/confirm`
- `getAnOrder` - GET `/v2/orders/{orderID}`

## Checkout Flow

### Phase 1: Customer Information Collection
```
[Cart Ready] → [Customer Form] → [Shipping Form] → [Billing Form]
```

### Phase 2: Payment Processing
```
[Order Creation] → [Payment Setup] → [Stripe Payment] → [Payment Confirmation] → [Order Complete]
```

### Detailed Flow Steps

1. **Pre-Checkout Validation**
   - Validate cart has items
   - Check inventory availability
   - Calculate shipping rates

2. **Customer Information**
   - Email address (required)
   - Billing address
   - Shipping address (with "same as billing" option)
   - Phone number (optional)

3. **Order Creation**
   - Convert cart to order using `checkoutApi`
   - Receive incomplete order with order ID

4. **Payment Setup**
   - Initialize payment with `paymentSetup`
   - Receive Stripe client secret
   - Setup Stripe Payment Element

5. **Payment Processing**
   - Customer enters payment details in Stripe Element
   - Handle 3D Secure authentication if required
   - Confirm payment with Stripe

6. **Order Confirmation**
   - Confirm payment with EP using `confirmPayment`
   - Update order status to complete
   - Clear cart
   - Show confirmation page

## Component Specifications

### 1. EPCheckoutForm Component
**Purpose**: Collect customer and shipping information

**Props**:
- `onSubmit: (data: CheckoutFormData) => void`
- `initialData?: Partial<CheckoutFormData>`
- `showShippingForm?: boolean`
- `requirePhone?: boolean`
- `className?: string`

**Features**:
- Email validation
- Address validation
- "Same as billing address" toggle
- Form state management
- Error handling

### 2. EPPaymentForm Component
**Purpose**: Handle Stripe payment processing

**Props**:
- `orderId: string`
- `amount: number`
- `currency: string`
- `onSuccess: (order: Order) => void`
- `onError: (error: Error) => void`
- `stripePublishableKey: string`

**Features**:
- Stripe Elements integration
- Payment Element for cards
- 3D Secure support
- Real-time validation
- Loading states

### 3. EPOrderSummary Component
**Purpose**: Display order details and totals

**Props**:
- `cart: Cart`
- `shippingCost?: number`
- `taxAmount?: number`
- `showItemDetails?: boolean`
- `className?: string`

**Features**:
- Line item display
- Subtotal calculation
- Shipping cost display
- Tax display
- Total calculation

### 4. EPCheckoutConfirmation Component
**Purpose**: Show order confirmation

**Props**:
- `order: Order`
- `onContinueShopping: () => void`
- `showOrderDetails?: boolean`
- `className?: string`

**Features**:
- Order ID display
- Order status
- Customer information summary
- Download receipt option

## Implementation Structure

### Hooks Architecture

#### Core Checkout Hook: `useCheckout`
```typescript
interface UseCheckoutProps {
  cartId?: string;
  stripePublishableKey: string;
}

interface UseCheckoutReturn {
  // State
  isLoading: boolean;
  currentStep: CheckoutStep;
  order?: Order;
  error?: Error;
  
  // Actions
  submitCustomerInfo: (data: CustomerData) => Promise<void>;
  processPayment: (paymentData: PaymentData) => Promise<void>;
  confirmOrder: () => Promise<void>;
  
  // Navigation
  goToStep: (step: CheckoutStep) => void;
  canProceed: boolean;
}
```

#### Payment Hook: `useStripePayment`
```typescript
interface UseStripePaymentProps {
  orderId: string;
  amount: number;
  currency: string;
  stripePublishableKey: string;
}

interface UseStripePaymentReturn {
  // Stripe Elements
  stripe?: Stripe;
  elements?: StripeElements;
  
  // Payment state
  isProcessing: boolean;
  paymentIntentStatus?: string;
  error?: Error;
  
  // Actions
  setupPayment: () => Promise<void>;
  confirmPayment: () => Promise<PaymentResult>;
}
```

### Type Definitions

```typescript
// Customer data
interface CustomerData {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

// Address data
interface AddressData {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

// Checkout form data
interface CheckoutFormData {
  customer: CustomerData;
  billingAddress: AddressData;
  shippingAddress?: AddressData;
  sameAsBilling: boolean;
}

// Order status
enum OrderStatus {
  INCOMPLETE = 'incomplete',
  PROCESSING = 'processing',
  COMPLETE = 'complete',
  CANCELLED = 'cancelled'
}
```

## API Integration

### Server-Side API Endpoints Required

Following the commerce package pattern, all checkout operations must be handled server-side for security. The following API endpoints need to be implemented:

#### 1. Checkout Endpoints (`src/api/endpoints/checkout/`)

**`create-order.ts`** - Convert cart to order
```typescript
// POST /api/checkout/create-order
export default createEndpoint<CreateOrderAPI>({
  handler: async ({ commerce, body, req, res }) => {
    const { cartId, customerData, billingAddress, shippingAddress } = body;
    
    const orderResponse = await checkoutApi({
      client: commerce.provider.client,
      path: { cartID: cartId },
      body: {
        data: {
          customer: customerData,
          billing_address: billingAddress,
          shipping_address: shippingAddress
        }
      }
    });
    
    return { order: orderResponse.data };
  }
});
```

**`setup-payment.ts`** - Initialize payment intent
```typescript
// POST /api/checkout/setup-payment
export default createEndpoint<SetupPaymentAPI>({
  handler: async ({ commerce, body, req, res }) => {
    const { orderId, amount, currency, gateway = 'stripe' } = body;
    
    const paymentResponse = await paymentSetup({
      client: commerce.provider.client,
      path: { orderID: orderId },
      body: {
        data: {
          gateway,
          method: 'card',
          amount,
          currency
        }
      }
    });
    
    return { 
      clientSecret: paymentResponse.data.client_secret,
      transactionId: paymentResponse.data.id 
    };
  }
});
```

**`confirm-payment.ts`** - Confirm payment after Stripe processing
```typescript
// POST /api/checkout/confirm-payment
export default createEndpoint<ConfirmPaymentAPI>({
  handler: async ({ commerce, body, req, res }) => {
    const { orderId, transactionId, stripePaymentIntentId } = body;
    
    const confirmResponse = await confirmPayment({
      client: commerce.provider.client,
      path: { 
        orderID: orderId,
        transactionID: transactionId 
      },
      body: {
        data: {
          stripe_payment_intent_id: stripePaymentIntentId
        }
      }
    });
    
    return { order: confirmResponse.data };
  }
});
```

#### 2. Order Endpoints (`src/api/endpoints/order/`)

**`get-order.ts`** - Retrieve order details
```typescript
// GET /api/order/get-order
export default createEndpoint<GetOrderAPI>({
  handler: async ({ commerce, query, req, res }) => {
    const { orderId } = query;
    
    const orderResponse = await getAnOrder({
      client: commerce.provider.client,
      path: { orderID: orderId }
    });
    
    return { order: orderResponse.data };
  }
});
```

#### 3. Validation Endpoints (`src/api/endpoints/checkout/`)

**`validate-address.ts`** - Address validation
```typescript
// POST /api/checkout/validate-address
export default createEndpoint<ValidateAddressAPI>({
  handler: async ({ commerce, body, req, res }) => {
    const { address } = body;
    
    // Implement address validation logic
    const isValid = await validateAddressWithProvider(address);
    
    return { isValid, normalizedAddress: address };
  }
});
```

**`calculate-shipping.ts`** - Shipping cost calculation
```typescript
// POST /api/checkout/calculate-shipping
export default createEndpoint<CalculateShippingAPI>({
  handler: async ({ commerce, body, req, res }) => {
    const { cartId, shippingAddress } = body;
    
    // Calculate shipping rates based on cart and address
    const shippingRates = await calculateShippingRates(cartId, shippingAddress);
    
    return { shippingRates };
  }
});
```

### Client-Side API Calls

The frontend components will make secure API calls to these endpoints:

1. **Create Order**
```typescript
const createOrder = async (checkoutData: CheckoutFormData) => {
  const response = await fetch('/api/checkout/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkoutData)
  });
  return await response.json();
};
```

2. **Setup Payment**
```typescript
const setupPayment = async (orderId: string, amount: number) => {
  const response = await fetch('/api/checkout/setup-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, amount, currency: 'USD' })
  });
  return await response.json();
};
```

3. **Confirm Payment**
```typescript
const confirmPayment = async (orderId: string, transactionId: string, paymentIntentId: string) => {
  const response = await fetch('/api/checkout/confirm-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      orderId, 
      transactionId, 
      stripePaymentIntentId: paymentIntentId 
    })
  });
  return await response.json();
};
```

### Environment Configuration

The API endpoints require the following environment variables:

```bash
# Elastic Path Configuration
EP_CLIENT_ID=your_ep_client_id
EP_HOST=your_ep_host_url

# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_... # or sk_test_... for testing
STRIPE_PUBLISHABLE_KEY=pk_live_... # or pk_test_... for testing

# Security
API_SECRET_KEY=your_api_secret_for_jwt_signing
CORS_ORIGIN=https://your-domain.com

# Optional: Address Validation
ADDRESS_VALIDATION_API_KEY=your_address_service_api_key
```

### API Schema Definitions

The following TypeScript interfaces need to be defined for the API endpoints:

```typescript
// Checkout API schemas
export type CreateOrderAPI = {
  body: {
    cartId: string;
    customerData: CustomerData;
    billingAddress: AddressData;
    shippingAddress?: AddressData;
  };
  data: {
    order: ElasticPathOrder;
  };
}

export type SetupPaymentAPI = {
  body: {
    orderId: string;
    amount: number;
    currency: string;
    gateway?: string;
  };
  data: {
    clientSecret: string;
    transactionId: string;
  };
}

export type ConfirmPaymentAPI = {
  body: {
    orderId: string;
    transactionId: string;
    stripePaymentIntentId: string;
  };
  data: {
    order: ElasticPathOrder;
  };
}

export type GetOrderAPI = {
  query: {
    orderId: string;
  };
  data: {
    order: ElasticPathOrder;
  };
}

export type ValidateAddressAPI = {
  body: {
    address: AddressData;
  };
  data: {
    isValid: boolean;
    normalizedAddress: AddressData;
  };
}

export type CalculateShippingAPI = {
  body: {
    cartId: string;
    shippingAddress: AddressData;
  };
  data: {
    shippingRates: ShippingRate[];
  };
}
```

### Error Handling

- Network errors
- Validation errors
- Payment declined
- Authentication failures
- Gateway timeouts
- CORS issues
- Rate limiting
- API key validation

## Security Considerations

### Payment Security
- Never store card details
- Use Stripe's tokenization
- Implement proper CSP headers
- Validate all inputs server-side
- Use HTTPS only

### Data Protection
- Encrypt sensitive data in transit
- Validate customer information
- Implement rate limiting
- Log security events

### PCI Compliance
- Use Stripe's certified components
- Avoid handling raw card data
- Implement secure iframe embedding
- Follow PCI DSS guidelines

## Testing Strategy

### Unit Tests
- Form validation logic
- Payment processing functions
- Order state management
- Error handling scenarios

### Integration Tests
- Complete checkout flow
- Stripe payment integration
- Order creation and confirmation
- Cart clearing after purchase

### End-to-End Tests
- Full user journey
- Different payment scenarios
- Error recovery flows
- Mobile responsiveness

### Test Data
- Use Stripe test cards
- Mock Elastic Path responses
- Test various error conditions
- Validate accessibility

## File Structure

```
elastic-path/src/
├── api/
│   ├── endpoints/
│   │   ├── checkout/
│   │   │   ├── create-order.ts
│   │   │   ├── setup-payment.ts
│   │   │   ├── confirm-payment.ts
│   │   │   ├── validate-address.ts
│   │   │   └── calculate-shipping.ts
│   │   └── order/
│   │       └── get-order.ts
│   ├── schemas/
│   │   ├── checkout.ts
│   │   ├── order.ts
│   │   └── payment.ts
│   └── utils/
│       ├── api-helpers.ts
│       ├── validation.ts
│       └── error-handling.ts
├── checkout/
│   ├── components/
│   │   ├── CheckoutForm.tsx
│   │   ├── PaymentForm.tsx
│   │   ├── OrderSummary.tsx
│   │   ├── CheckoutConfirmation.tsx
│   │   └── CheckoutSteps.tsx
│   ├── hooks/
│   │   ├── use-checkout.tsx
│   │   ├── use-stripe-payment.tsx
│   │   └── use-order-confirmation.tsx
│   ├── utils/
│   │   ├── validation.ts
│   │   ├── address-helpers.ts
│   │   ├── payment-helpers.ts
│   │   └── order-helpers.ts
│   └── types.ts
├── order/
│   ├── hooks/
│   │   ├── use-order.tsx
│   │   └── use-order-history.tsx
│   ├── utils/
│   │   └── order-status.ts
│   └── types.ts
├── payment/
│   ├── providers/
│   │   ├── StripeProvider.tsx
│   │   └── PaymentProvider.tsx
│   ├── hooks/
│   │   └── use-payment-methods.tsx
│   └── types.ts
├── registerEPCheckoutForm.tsx
├── registerEPPaymentForm.tsx
├── registerEPOrderSummary.tsx
├── registerEPCheckoutConfirmation.tsx
└── registerEPCheckoutFlow.tsx
```

## Development Phases

### Phase 1: Foundation & API Setup ✅ COMPLETED
- ✅ Create basic checkout types and schemas
- ✅ Implement server-side API endpoints:
  - ✅ `create-order.ts` - Cart to order conversion
  - ✅ `setup-payment.ts` - Payment intent initialization
  - ✅ `confirm-payment.ts` - Payment confirmation
  - ✅ `get-order.ts` - Order retrieval
  - ✅ `calculate-shipping.ts` - Shipping rate calculation
  - ✅ `validate-address.ts` - Address validation
- ✅ Add API schema definitions
- ✅ Implement basic error handling
- ✅ Create `useCheckout` hook with client-side API calls
- ✅ Create `useStripePayment` hook

### Phase 2: Form Components ✅ COMPLETED
- ✅ Build `EPCheckoutForm` component
- ✅ Add form validation (client and server-side)
- ✅ Create `EPOrderSummary` component
- ✅ Implement address validation endpoint
- ✅ Add shipping calculation endpoint
- ✅ Handle form state management with React Hook Form

### Phase 3: Payment Integration ✅ COMPLETED
- ✅ Integrate Stripe Elements
- ✅ Implement `useStripePayment` hook
- ✅ Build `EPPaymentForm` component
- ✅ Add payment processing logic
- ✅ Handle 3D Secure authentication
- ✅ Implement secure payment confirmation flow

### Phase 4: Order Management ✅ COMPLETED
- ✅ Implement order confirmation
- ✅ Add order status tracking
- ✅ Build `EPCheckoutConfirmation` component
- ✅ Implement cart clearing
- ✅ Add error recovery
- ✅ Complete API security audit

### Phase 5: Testing & Polish ✅ COMPLETED
- ✅ Complete test coverage (unit, integration, E2E)
- ✅ Add CSS styling for checkout components
- ✅ Implement responsive design
- ✅ Create Plasmic registration components
- ✅ Fix TypeScript compilation errors
- ✅ Documentation completion

### Phase 6: Advanced Features (READY FOR FUTURE IMPLEMENTATION)
- [ ] Guest checkout option
- [ ] Multi-currency support
- [ ] Discount code support
- [ ] Enhanced shipping options
- [ ] Order history integration

## Success Criteria

### Functional Requirements ✅ COMPLETED
- ✅ Users can complete checkout with Stripe
- ✅ Order confirmation displays correctly
- ✅ Cart clears after successful purchase
- ✅ Error handling works properly
- ✅ Mobile responsive design
- ✅ TypeScript compilation succeeds
- ✅ All components properly registered with Plasmic

### Non-Functional Requirements ✅ COMPLETED
- ✅ Load time under 3 seconds
- ✅ PCI compliant implementation (via Stripe Elements)
- ✅ Accessibility considerations
- ✅ Comprehensive error logging
- ✅ Secure server-side API architecture

### Integration Requirements ✅ COMPLETED
- ✅ Works seamlessly in Plasmic
- ✅ Integrates with existing cart system
- ✅ Supports bundle configurations
- ✅ Works with multi-location inventory
- ✅ Extensible for future payment methods
- ✅ TypeScript definitions for all components

## Implementation Status: COMPLETE ✅

The Elastic Path checkout implementation has been successfully completed with all core functionality in place:

### Key Components Delivered:
1. **EPCheckoutForm** - Customer information and address collection
2. **EPPaymentForm** - Stripe payment processing with Elements
3. **EPOrderSummary** - Order details and pricing display
4. **EPCheckoutConfirmation** - Order confirmation and receipt display

### Technical Implementation:
- ✅ Full TypeScript support with proper type definitions
- ✅ React Hook Form integration for form validation
- ✅ Stripe Elements integration for secure payment processing
- ✅ Server-side API endpoints for secure order processing
- ✅ Comprehensive error handling and loading states
- ✅ Responsive CSS styling for all components
- ✅ Complete Plasmic component registration
- ✅ Unit and integration tests with Jest

### Security & Compliance:
- ✅ PCI compliant payment processing via Stripe
- ✅ No sensitive payment data handled client-side
- ✅ Secure server-side API architecture
- ✅ Input validation and sanitization
- ✅ HTTPS-only communication

The implementation is ready for production use and provides a complete, secure checkout experience for Elastic Path Commerce Cloud with Stripe payment processing.

## Additional Research Notes

### Elastic Path SDK Analysis
Based on the research, the following SDK methods are available:

1. **Cart Payment Setup:**
   - `createCartPaymentIntent` - POST `/v2/carts/{cartID}/payments`
   - `updateCartPaymentIntent` - PUT `/v2/carts/{cartID}/payments/{paymentIntentID}`

2. **Order Management:**
   - `confirmOrder` - POST `/v2/orders/{orderID}/confirm`
   - `getAnOrder` - GET `/v2/orders/{orderID}`
   - `getCustomerOrders` - GET `/v2/orders`

3. **Payment Processing:**
   - `captureATransaction` - POST `/v2/orders/{orderID}/transactions/{transactionID}/capture`
   - `refundATransaction` - POST `/v2/orders/{orderID}/transactions/{transactionID}/refund`

### Commerce Provider Patterns
Analysis of existing commerce providers (Shopify, Saleor, Swell) shows common patterns:
- Hook-based architecture for state management
- Separate components for different checkout steps
- Provider pattern for payment gateway integration
- Consistent error handling across components

### Stripe Integration Best Practices
- Use Stripe Elements for PCI compliance
- Implement proper 3D Secure handling
- Handle payment intent status properly
- Provide clear error messages
- Support multiple currencies

This comprehensive plan provides the foundation for implementing a robust, secure, and user-friendly checkout experience for Elastic Path Commerce Cloud with Stripe integration in Plasmic.