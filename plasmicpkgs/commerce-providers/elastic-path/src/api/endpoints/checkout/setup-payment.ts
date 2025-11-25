import { paymentSetup } from "@epcc-sdk/sdks-shopper";
import Stripe from "stripe";
import type { SetupPaymentAPI } from "../../schemas/checkout";
import { 
  createSuccessResponse, 
  createErrorResponse, 
  validateMethod, 
  validateRequestBody,
  toCents
} from "../../utils/api-helpers";
import { 
  validateOrderAmount,
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
 * API endpoint to setup payment intent for an order
 * POST /api/checkout/setup-payment
 */
export default async function setupPaymentHandler(req: any, res: any) {
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
    const body = validateRequestBody<SetupPaymentAPI['body']>(req, [
      'orderId',
      'amount',
      'currency'
    ]);

    const { orderId, amount, currency, gateway = 'stripe' } = body;

    // Validate order amount
    const amountValidation = validateOrderAmount(amount, currency);
    if (!amountValidation.isValid) {
      throw new ValidationError('Invalid order amount', { 
        fieldErrors: amountValidation.errors 
      });
    }

    // Validate order ID format
    if (!orderId || typeof orderId !== 'string' || orderId.length < 1) {
      throw new ValidationError('Valid order ID is required');
    }

    // Validate gateway
    if (gateway !== 'stripe') {
      throw new ValidationError(`Unsupported payment gateway: ${gateway}`);
    }

    // Convert amount to cents for Stripe
    const amountInCents = toCents(amount);

    // Validate minimum amount (Stripe requires minimum $0.50 USD)
    if (amountInCents < 50) {
      throw new ValidationError('Order amount must be at least $0.50');
    }

    // Initialize Elastic Path client
    const client = {
      settings: {
        application_id: process.env.EP_CLIENT_ID!,
        host: process.env.EP_HOST || 'https://api.moltin.com'
      }
    };

    // Create Stripe Payment Intent first
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      automatic_payment_methods: {
        enabled: true
      },
      metadata: {
        order_id: orderId,
        source: 'elastic-path-checkout'
      }
    });

    if (!paymentIntent.client_secret) {
      throw new PaymentError('Failed to create payment intent');
    }

    // Setup payment with Elastic Path using Stripe payment intent
    const paymentData = {
      gateway: 'stripe',
      method: 'card',
      amount: amountInCents,
      currency: currency.toLowerCase(),
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret
    };

    const paymentResponse = await paymentSetup({
      client,
      path: { orderID: orderId },
      body: {
        data: paymentData
      }
    });

    if (!paymentResponse.data || !paymentResponse.data.data) {
      // If EP setup fails, we should cancel the Stripe payment intent
      try {
        await stripe.paymentIntents.cancel(paymentIntent.id);
      } catch (cancelError) {
        console.error('Failed to cancel Stripe payment intent:', cancelError);
      }
      
      throw new PaymentError('Failed to setup payment with Elastic Path');
    }

    const transaction = paymentResponse.data.data;

    // Log successful payment setup
    console.log(`Payment setup successful for order: ${orderId}, transaction: ${transaction.id}`);

    return res.status(200).json(createSuccessResponse<SetupPaymentAPI['data']>({
      clientSecret: paymentIntent.client_secret,
      transactionId: transaction.id,
      paymentIntentId: paymentIntent.id
    }));

  } catch (error) {
    console.error('Setup payment error:', error);

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
      endpoint: 'setup-payment',
      orderId: req.body?.orderId,
      amount: req.body?.amount,
      currency: req.body?.currency,
      gateway: req.body?.gateway,
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
 * Validates Stripe configuration
 */
function validateStripeConfig(): void {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new ValidationError('Stripe secret key not configured');
  }

  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    throw new ValidationError('Stripe publishable key not configured');
  }

  // Validate key format
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey.startsWith('sk_')) {
    throw new ValidationError('Invalid Stripe secret key format');
  }

  // Check if using test key in production
  if (process.env.NODE_ENV === 'production' && secretKey.includes('test')) {
    throw new ValidationError('Cannot use Stripe test keys in production');
  }
}

/**
 * Gets supported currencies for the gateway
 */
function getSupportedCurrencies(gateway: string): string[] {
  const currencyMap: Record<string, string[]> = {
    stripe: [
      'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK',
      'PLN', 'CZK', 'HUF', 'BGN', 'RON', 'HRK', 'MXN', 'BRL', 'SGD', 'HKD',
      'NZD', 'THB', 'MYR', 'INR'
    ]
  };

  return currencyMap[gateway] || [];
}

/**
 * Validates currency support for the gateway
 */
function validateCurrencySupport(currency: string, gateway: string): void {
  const supportedCurrencies = getSupportedCurrencies(gateway);
  
  if (supportedCurrencies.length > 0 && !supportedCurrencies.includes(currency.toUpperCase())) {
    throw new ValidationError(
      `Currency ${currency} is not supported by ${gateway}`,
      { 
        supportedCurrencies,
        requestedCurrency: currency,
        gateway 
      }
    );
  }
}