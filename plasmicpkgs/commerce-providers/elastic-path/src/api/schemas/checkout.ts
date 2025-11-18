import type { CustomerData, AddressData, ElasticPathOrder, ShippingRate } from '../../checkout/types';

/**
 * API Schema for creating an order from cart
 */
export interface CreateOrderAPI {
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

/**
 * API Schema for setting up payment intent
 */
export interface SetupPaymentAPI {
  body: {
    orderId: string;
    amount: number;
    currency: string;
    gateway?: string;
  };
  data: {
    clientSecret: string;
    transactionId: string;
    paymentIntentId?: string;
  };
}

/**
 * API Schema for confirming payment after Stripe processing
 */
export interface ConfirmPaymentAPI {
  body: {
    orderId: string;
    transactionId: string;
    stripePaymentIntentId: string;
  };
  data: {
    order: ElasticPathOrder;
  };
}

/**
 * API Schema for calculating shipping rates
 */
export interface CalculateShippingAPI {
  body: {
    cartId: string;
    shippingAddress: AddressData;
  };
  data: {
    shippingRates: ShippingRate[];
  };
}

/**
 * API Schema for address validation
 */
export interface ValidateAddressAPI {
  body: {
    address: AddressData;
    type?: 'billing' | 'shipping';
  };
  data: {
    isValid: boolean;
    errors?: Record<string, string>;
    suggestions?: AddressData[];
    normalized?: AddressData;
  };
}

