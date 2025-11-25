/**
 * Customer information for checkout
 */
export interface CustomerData {
  name: string;
  email: string;
}

/**
 * Address information for billing and shipping
 */
export interface AddressData {
  first_name: string;
  last_name: string;
  line_1: string;
  line_2?: string;
  city: string;
  county?: string;
  country: string;
  postcode: string;
}

/**
 * Complete checkout form data structure
 */
export interface CheckoutFormData {
  customer: CustomerData;
  billingAddress: AddressData;
  shippingAddress?: AddressData;
  sameAsBilling: boolean;
}

/**
 * Shipping rate option
 */
export interface ShippingRate {
  id: string;
  name: string;
  description?: string;
  amount: number;
  currency: string;
  delivery_time?: string;
  service_level: string;
  carrier?: string;
}

/**
 * Order status enumeration
 */
export enum OrderStatus {
  INCOMPLETE = 'incomplete',
  PROCESSING = 'processing',
  COMPLETE = 'complete',
  CANCELLED = 'cancelled',
  PARTIALLY_AUTHORIZED = 'partially_authorized',
  PARTIALLY_PAID = 'partially_paid'
}

/**
 * Payment status enumeration
 */
export enum PaymentStatus {
  PENDING = 'pending',
  AUTHORIZED = 'authorized',
  PAID = 'paid',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
  REFUNDED = 'refunded'
}

/**
 * Checkout step enumeration
 */
export enum CheckoutStep {
  CUSTOMER_INFO = 'customer_info',
  SHIPPING = 'shipping',
  PAYMENT = 'payment',
  CONFIRMATION = 'confirmation'
}

/**
 * Payment setup response from Elastic Path
 */
export interface PaymentSetup {
  id: string;
  type: 'transaction';
  gateway: string;
  amount: number;
  currency: string;
  status: string;
  payment_intent?: {
    client_secret: string;
    payment_intent_id: string;
  };
}

/**
 * Elastic Path order structure
 */
export interface ElasticPathOrder {
  id: string;
  type: 'order';
  status: OrderStatus | string;
  payment: PaymentStatus | string;
  total: {
    amount: number;
    currency: string;
  };
  subtotal: {
    amount: number;
    currency: string;
  };
  tax: {
    amount: number;
    currency: string;
  };
  shipping?: {
    amount: number;
    currency: string;
  };
  customer?: {
    name: string;
    email: string;
  };
  billing_address?: AddressData;
  shipping_address?: AddressData;
  relationships: {
    items: {
      data: Array<{
        type: 'item';
        id: string;
      }>;
    };
  };
  meta?: any;
}

/**
 * Checkout state interface
 */
export interface CheckoutState {
  currentStep: CheckoutStep;
  customerData?: CustomerData;
  billingAddress?: AddressData;
  shippingAddress?: AddressData;
  selectedShippingRate?: ShippingRate;
  order?: ElasticPathOrder;
  paymentSetup?: PaymentSetup;
  isLoading: boolean;
  error?: Error;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

/**
 * API response wrapper
 */
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, any>;
  };
}