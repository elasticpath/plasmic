import type { PaymentGateway, PaymentSetupResponse } from '../../checkout/types';

/**
 * Payment method information
 */
export interface PaymentMethod {
  id: string;
  type: string;
  gateway: PaymentGateway;
  name: string;
  enabled: boolean;
  test_mode?: boolean;
}

/**
 * API Schema for retrieving available payment methods
 */
export interface GetPaymentMethodsAPI {
  query: {
    currency?: string;
    amount?: number;
  };
  data: {
    paymentMethods: PaymentMethod[];
  };
}

/**
 * API Schema for payment webhook handling
 */
export interface PaymentWebhookAPI {
  body: {
    type: string;
    data: Record<string, any>;
    signature?: string;
  };
  data: {
    processed: boolean;
    orderId?: string;
    status?: string;
  };
}

/**
 * API Schema for payment status check
 */
export interface GetPaymentStatusAPI {
  query: {
    orderId: string;
    transactionId?: string;
  };
  data: {
    status: string;
    amount: number;
    currency: string;
    gateway: PaymentGateway;
    details: PaymentSetupResponse;
  };
}

/**
 * Refund request structure
 */
export interface RefundRequest {
  amount?: number; // If not provided, full refund
  reason?: string;
  metadata?: Record<string, string>;
}

/**
 * API Schema for processing refunds
 */
export interface ProcessRefundAPI {
  body: {
    orderId: string;
    transactionId: string;
    refund: RefundRequest;
  };
  data: {
    refundId: string;
    amount: number;
    currency: string;
    status: string;
  };
}