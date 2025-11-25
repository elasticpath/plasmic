import { confirmPayment } from "@epcc-sdk/sdks-shopper";
import Stripe from "stripe";
import type { ConfirmPaymentAPI } from "../../schemas/checkout";
import type { ElasticPathOrder } from "../../../checkout/types";
import { 
  createSuccessResponse, 
  createErrorResponse, 
  validateMethod, 
  validateRequestBody 
} from "../../utils/api-helpers";
import { 
  validateEnvironmentVariables 
} from "../../utils/validation";
import { 
  handleElasticPathError, 
  handleStripeError,
  logError, 
  getHttpStatusForError,
  CheckoutError,
  ValidationError,
  PaymentError 
} from "../../utils/error-handling";

/**
 * API endpoint to confirm payment after Stripe processing
 * POST /api/checkout/confirm-payment
 */
export default async function confirmPaymentHandler(req: any, res: any) {
  let stripe: Stripe | null = null;
  
  try {
    // Validate environment
    validateEnvironmentVariables();

    // Initialize Stripe
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16'
    });

    // Validate HTTP method
    if (!validateMethod(req, ['POST'])) {
      return res.status(405).json(createErrorResponse('Method not allowed'));
    }

    // Validate and extract request body
    const body = validateRequestBody<ConfirmPaymentAPI['body']>(req, [
      'orderId',
      'transactionId',
      'stripePaymentIntentId'
    ]);

    const { orderId, transactionId, stripePaymentIntentId } = body;

    // Validate IDs format
    if (!orderId || typeof orderId !== 'string' || orderId.length < 1) {
      throw new ValidationError('Valid order ID is required');
    }

    if (!transactionId || typeof transactionId !== 'string' || transactionId.length < 1) {
      throw new ValidationError('Valid transaction ID is required');
    }

    if (!stripePaymentIntentId || typeof stripePaymentIntentId !== 'string' || !stripePaymentIntentId.startsWith('pi_')) {
      throw new ValidationError('Valid Stripe payment intent ID is required');
    }

    // Verify payment intent status with Stripe first
    const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
    
    if (!paymentIntent) {
      throw new PaymentError('Payment intent not found');
    }

    // Check if payment was successful
    if (paymentIntent.status !== 'succeeded') {
      throw new PaymentError(
        `Payment not completed. Status: ${paymentIntent.status}`,
        { 
          paymentIntentStatus: paymentIntent.status,
          paymentIntentId: stripePaymentIntentId 
        }
      );
    }

    // Verify the payment intent matches our order
    if (paymentIntent.metadata.order_id !== orderId) {
      throw new PaymentError('Payment intent does not match order', {
        expectedOrderId: orderId,
        paymentIntentOrderId: paymentIntent.metadata.order_id
      });
    }

    // Initialize Elastic Path client
    const client = {
      settings: {
        application_id: process.env.EP_CLIENT_ID!,
        host: process.env.EP_HOST || 'https://api.moltin.com'
      }
    };

    // Prepare confirmation data for Elastic Path
    const confirmationData = {
      gateway: 'stripe',
      payment_intent_id: stripePaymentIntentId,
      status: 'paid',
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      metadata: {
        stripe_payment_intent_id: stripePaymentIntentId,
        stripe_charge_id: paymentIntent.latest_charge,
        confirmation_timestamp: new Date().toISOString()
      }
    };

    // Confirm payment with Elastic Path
    const confirmResponse = await confirmPayment({
      client,
      path: { 
        orderID: orderId,
        transactionID: transactionId 
      },
      body: {
        data: confirmationData
      }
    });

    if (!confirmResponse.data || !confirmResponse.data.data) {
      throw new PaymentError('Failed to confirm payment with Elastic Path');
    }

    // Get the updated order
    const updatedOrder = confirmResponse.data.data;

    // Transform to our order format
    const order: ElasticPathOrder = transformElasticPathOrder(updatedOrder);

    // Log successful payment confirmation
    console.log(`Payment confirmed successfully for order: ${orderId}, transaction: ${transactionId}`);

    // Optional: Send confirmation email, webhook, etc.
    await handlePostPaymentActions(order, paymentIntent);

    return res.status(200).json(createSuccessResponse<ConfirmPaymentAPI['data']>({
      order
    }));

  } catch (error) {
    console.error('Confirm payment error:', error);

    let checkoutError: CheckoutError;

    if (error instanceof CheckoutError) {
      checkoutError = error;
    } else if (error.type && error.type.startsWith('Stripe')) {
      // Handle Stripe specific errors
      checkoutError = handleStripeError(error);
    } else {
      // Handle Elastic Path specific errors
      checkoutError = handleElasticPathError(error);
    }

    // Log the error with context
    logError(checkoutError, {
      endpoint: 'confirm-payment',
      orderId: req.body?.orderId,
      transactionId: req.body?.transactionId,
      stripePaymentIntentId: req.body?.stripePaymentIntentId,
      timestamp: new Date().toISOString()
    });

    const statusCode = getHttpStatusForError(checkoutError);
    
    return res.status(statusCode).json(createErrorResponse(
      checkoutError.message,
      checkoutError.code,
      checkoutError.details
    ));
  }
}

/**
 * Transforms Elastic Path order response to our standardized format
 */
function transformElasticPathOrder(epOrder: any): ElasticPathOrder {
  return {
    id: epOrder.id,
    type: 'order',
    status: mapElasticPathStatus(epOrder.status),
    payment: mapPaymentStatus(epOrder.payment || epOrder.status),
    total: {
      amount: epOrder.meta?.display_price?.with_tax?.amount || 0,
      currency: epOrder.meta?.display_price?.with_tax?.currency || 'USD'
    },
    subtotal: {
      amount: epOrder.meta?.display_price?.without_tax?.amount || 0,
      currency: epOrder.meta?.display_price?.without_tax?.currency || 'USD'
    },
    tax: {
      amount: epOrder.meta?.display_price?.tax?.amount || 0,
      currency: epOrder.meta?.display_price?.tax?.currency || 'USD'
    },
    shipping: epOrder.shipping ? {
      amount: epOrder.shipping.amount || 0,
      currency: epOrder.shipping.currency || 'USD'
    } : undefined,
    customer: epOrder.customer ? {
      name: epOrder.customer.name,
      email: epOrder.customer.email
    } : undefined,
    billing_address: epOrder.billing_address,
    shipping_address: epOrder.shipping_address,
    relationships: epOrder.relationships || { items: { data: [] } },
    meta: epOrder.meta
  };
}

/**
 * Maps Elastic Path order status to our enum
 */
function mapElasticPathStatus(epStatus: string): any {
  const statusMap: Record<string, any> = {
    'incomplete': 'incomplete',
    'processing': 'processing',
    'complete': 'complete',
    'cancelled': 'cancelled',
    'partially_authorized': 'partially_authorized',
    'partially_paid': 'partially_paid'
  };

  return statusMap[epStatus] || 'incomplete';
}

/**
 * Maps payment status
 */
function mapPaymentStatus(status: string): any {
  const paymentStatusMap: Record<string, any> = {
    'pending': 'pending',
    'authorized': 'authorized',
    'paid': 'paid',
    'complete': 'paid',
    'cancelled': 'cancelled',
    'failed': 'failed',
    'refunded': 'refunded'
  };

  return paymentStatusMap[status] || 'pending';
}

/**
 * Handle post-payment actions
 */
async function handlePostPaymentActions(
  order: ElasticPathOrder, 
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  try {
    // Log successful payment
    console.log(`Payment successful for order ${order.id}:`, {
      orderId: order.id,
      amount: order.total.amount,
      currency: order.total.currency,
      customerEmail: order.customer?.email,
      stripePaymentIntentId: paymentIntent.id,
      timestamp: new Date().toISOString()
    });

    // Here you could add:
    // - Send confirmation email
    // - Update inventory
    // - Trigger webhooks
    // - Send to analytics
    // - Update customer records
    
    // Example: Basic analytics tracking
    if (process.env.ANALYTICS_ENABLED === 'true') {
      // trackPurchase(order, paymentIntent);
    }

    // Example: Send webhook notification
    if (process.env.WEBHOOK_URL) {
      // sendWebhookNotification(order, 'payment.completed');
    }

  } catch (error) {
    // Don't fail the payment confirmation for post-payment action errors
    console.error('Post-payment actions failed:', error);
  }
}

/**
 * Validates payment intent requirements
 */
function validatePaymentIntentForConfirmation(paymentIntent: Stripe.PaymentIntent): void {
  // Check required fields
  if (!paymentIntent.metadata?.order_id) {
    throw new PaymentError('Payment intent missing order metadata');
  }

  // Validate amount is reasonable
  if (paymentIntent.amount <= 0) {
    throw new PaymentError('Invalid payment amount');
  }

  // Check for suspicious activity
  if (paymentIntent.amount > 100000000) { // $1M limit
    throw new PaymentError('Payment amount exceeds maximum limit');
  }

  // Validate currency
  if (!paymentIntent.currency || paymentIntent.currency.length !== 3) {
    throw new PaymentError('Invalid payment currency');
  }
}