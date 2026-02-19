import { checkoutApi } from "@epcc-sdk/sdks-shopper";
import type { CreateOrderAPI } from "../../schemas/checkout";
import type { ElasticPathOrder } from "../../../checkout/types";
import { createLogger } from "../../../utils/logger";

const log = createLogger("createOrder");
import { 
  createSuccessResponse, 
  createErrorResponse, 
  validateMethod, 
  validateRequestBody 
} from "../../utils/api-helpers";
import { 
  validateCheckoutForm, 
  sanitizeCustomerData, 
  sanitizeAddressData,
  validateEnvironmentVariables 
} from "../../utils/validation";
import { 
  handleElasticPathError, 
  logError, 
  getHttpStatusForError,
  CheckoutError,
  ValidationError 
} from "../../utils/error-handling";

/**
 * API endpoint to create an order from a cart
 * POST /api/checkout/create-order
 */
export default async function createOrderHandler(req: any, res: any) {
  try {
    // Validate environment
    validateEnvironmentVariables();

    // Validate HTTP method
    if (!validateMethod(req, ['POST'])) {
      return res.status(405).json(createErrorResponse('Method not allowed'));
    }

    // Validate and extract request body
    const body = validateRequestBody<CreateOrderAPI['body']>(req, [
      'cartId',
      'customerData',
      'billingAddress'
    ]);

    const { cartId, customerData, billingAddress, shippingAddress } = body;

    // Sanitize input data
    const sanitizedCustomer = sanitizeCustomerData(customerData);
    const sanitizedBillingAddress = sanitizeAddressData(billingAddress);
    const sanitizedShippingAddress = shippingAddress 
      ? sanitizeAddressData(shippingAddress) 
      : undefined;

    // Validate checkout form data
    const validation = validateCheckoutForm({
      customer: sanitizedCustomer,
      billingAddress: sanitizedBillingAddress,
      shippingAddress: sanitizedShippingAddress,
      sameAsBilling: !shippingAddress
    });

    if (!validation.isValid) {
      throw new ValidationError('Invalid checkout data', { 
        fieldErrors: validation.errors 
      });
    }

    // Validate cart ID format
    if (!cartId || typeof cartId !== 'string' || cartId.length < 1) {
      throw new ValidationError('Valid cart ID is required');
    }

    // Initialize Elastic Path client
    const client = {
      settings: {
        application_id: process.env.EP_CLIENT_ID!,
        host: process.env.EP_HOST || 'https://api.moltin.com'
      }
    };

    // Prepare checkout data for Elastic Path
    const checkoutData = {
      customer: {
        name: `${sanitizedCustomer.firstName} ${sanitizedCustomer.lastName}`,
        email: sanitizedCustomer.email
      },
      billing_address: {
        first_name: sanitizedCustomer.firstName,
        last_name: sanitizedCustomer.lastName,
        line_1: sanitizedBillingAddress.line1,
        line_2: sanitizedBillingAddress.line2 || '',
        city: sanitizedBillingAddress.city,
        county: sanitizedBillingAddress.state,
        postcode: sanitizedBillingAddress.postalCode,
        country: sanitizedBillingAddress.country,
        company_name: sanitizedBillingAddress.company || ''
      },
      shipping_address: sanitizedShippingAddress ? {
        first_name: sanitizedCustomer.firstName,
        last_name: sanitizedCustomer.lastName,
        line_1: sanitizedShippingAddress.line1,
        line_2: sanitizedShippingAddress.line2 || '',
        city: sanitizedShippingAddress.city,
        county: sanitizedShippingAddress.state,
        postcode: sanitizedShippingAddress.postalCode,
        country: sanitizedShippingAddress.country,
        company_name: sanitizedShippingAddress.company || ''
      } : undefined
    };

    // Create order from cart using Elastic Path SDK
    const orderResponse = await checkoutApi({
      client,
      path: { cartID: cartId },
      body: {
        data: checkoutData
      }
    });

    if (!orderResponse.data || !orderResponse.data.data) {
      throw new CheckoutError('Failed to create order from cart');
    }

    // Transform Elastic Path order to our format
    const order: ElasticPathOrder = transformElasticPathOrder(orderResponse.data.data);

    // Log successful order creation
    log.info(`Order created successfully: ${order.id}`);

    return res.status(201).json(createSuccessResponse<CreateOrderAPI['data']>({
      order
    }));

  } catch (error) {
    log.error("Create order error", { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>);

    let checkoutError: CheckoutError;

    if (error instanceof CheckoutError) {
      checkoutError = error;
    } else {
      // Handle Elastic Path specific errors
      checkoutError = handleElasticPathError(error);
    }

    // Log the error with context
    logError(checkoutError, {
      endpoint: 'create-order',
      cartId: req.body?.cartId,
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
    payment: epOrder.payment || 'pending',
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