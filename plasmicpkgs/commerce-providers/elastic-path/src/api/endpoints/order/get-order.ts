import { getAnOrder } from "@epcc-sdk/sdks-shopper";
import type { GetOrderAPI } from "../../schemas/order";
import type { ElasticPathOrder } from "../../../checkout/types";
import { 
  createSuccessResponse, 
  createErrorResponse, 
  validateMethod 
} from "../../utils/api-helpers";
import { 
  validateEnvironmentVariables 
} from "../../utils/validation";
import { 
  handleElasticPathError, 
  logError, 
  getHttpStatusForError,
  CheckoutError,
  ValidationError,
  OrderError 
} from "../../utils/error-handling";

/**
 * API endpoint to retrieve an order by ID
 * GET /api/order/get-order?orderId=xxx
 */
export default async function getOrderHandler(req: any, res: any) {
  try {
    // Validate environment
    validateEnvironmentVariables();

    // Validate HTTP method
    if (!validateMethod(req, ['GET'])) {
      return res.status(405).json(createErrorResponse('Method not allowed'));
    }

    // Extract and validate query parameters
    const { orderId } = req.query;

    if (!orderId || typeof orderId !== 'string' || orderId.length < 1) {
      throw new ValidationError('Valid order ID is required');
    }

    // Initialize Elastic Path client
    const client = {
      settings: {
        application_id: process.env.EP_CLIENT_ID!,
        host: process.env.EP_HOST || 'https://api.moltin.com'
      }
    };

    // Retrieve order from Elastic Path
    const orderResponse = await getAnOrder({
      client,
      path: { orderID: orderId },
      query: {
        include: ['items', 'customer', 'transactions']
      }
    });

    if (!orderResponse.data || !orderResponse.data.data) {
      throw new OrderError('Order not found', { orderId });
    }

    // Transform Elastic Path order to our format
    const order: ElasticPathOrder = transformElasticPathOrder(
      orderResponse.data.data,
      orderResponse.data.included
    );

    // Log successful order retrieval
    console.log(`Order retrieved successfully: ${order.id}`);

    return res.status(200).json(createSuccessResponse<GetOrderAPI['data']>({
      order
    }));

  } catch (error) {
    console.error('Get order error:', error);

    let checkoutError: CheckoutError;

    if (error instanceof CheckoutError) {
      checkoutError = error;
    } else {
      // Handle Elastic Path specific errors
      checkoutError = handleElasticPathError(error);
      
      // Convert 404 to OrderError
      if (error.response?.status === 404) {
        checkoutError = new OrderError('Order not found', { 
          orderId: req.query?.orderId 
        });
      }
    }

    // Log the error with context
    logError(checkoutError, {
      endpoint: 'get-order',
      orderId: req.query?.orderId,
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
function transformElasticPathOrder(
  epOrder: any, 
  included?: any[]
): ElasticPathOrder {
  // Extract related data from included array
  const includedMap = createIncludedMap(included || []);
  
  // Get order items
  const items = epOrder.relationships?.items?.data?.map((itemRef: any) => {
    return includedMap[`${itemRef.type}:${itemRef.id}`];
  }).filter(Boolean) || [];

  // Get customer data
  const customer = epOrder.relationships?.customer?.data 
    ? includedMap[`${epOrder.relationships.customer.data.type}:${epOrder.relationships.customer.data.id}`]
    : null;

  // Get transactions
  const transactions = epOrder.relationships?.transactions?.data?.map((txRef: any) => {
    return includedMap[`${txRef.type}:${txRef.id}`];
  }).filter(Boolean) || [];

  return {
    id: epOrder.id,
    type: 'order',
    status: mapElasticPathStatus(epOrder.status),
    payment: determinePaymentStatus(transactions, epOrder.payment),
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
    customer: customer ? {
      name: customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      email: customer.email
    } : epOrder.customer ? {
      name: epOrder.customer.name,
      email: epOrder.customer.email
    } : undefined,
    billing_address: epOrder.billing_address,
    shipping_address: epOrder.shipping_address,
    relationships: {
      items: {
        data: items.map(item => ({
          type: 'item',
          id: item.id
        }))
      }
    },
    meta: {
      ...epOrder.meta,
      items: items,
      transactions: transactions,
      timestamps: {
        created_at: epOrder.meta?.timestamps?.created_at,
        updated_at: epOrder.meta?.timestamps?.updated_at
      }
    }
  };
}

/**
 * Creates a map of included resources for easy lookup
 */
function createIncludedMap(included: any[]): Record<string, any> {
  const map: Record<string, any> = {};
  
  included.forEach(item => {
    if (item.type && item.id) {
      map[`${item.type}:${item.id}`] = item;
    }
  });
  
  return map;
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
 * Determines payment status from transactions and order data
 */
function determinePaymentStatus(transactions: any[], orderPaymentStatus?: string): any {
  if (!transactions || transactions.length === 0) {
    return 'pending';
  }

  // Check if all transactions are successful
  const allSuccessful = transactions.every(tx => 
    tx.status === 'complete' || tx.status === 'paid'
  );

  if (allSuccessful) {
    return 'paid';
  }

  // Check if any transactions are authorized
  const hasAuthorized = transactions.some(tx => 
    tx.status === 'authorized' || tx.status === 'partially_authorized'
  );

  if (hasAuthorized) {
    return 'authorized';
  }

  // Check if any transactions failed
  const hasFailed = transactions.some(tx => 
    tx.status === 'failed' || tx.status === 'cancelled'
  );

  if (hasFailed) {
    return 'failed';
  }

  // Check for refunds
  const hasRefund = transactions.some(tx => 
    tx.status === 'refunded'
  );

  if (hasRefund) {
    return 'refunded';
  }

  // Fall back to order payment status or pending
  return orderPaymentStatus || 'pending';
}

/**
 * Validates order access permissions
 */
function validateOrderAccess(orderId: string, customerInfo?: any): void {
  // Here you would implement order access validation
  // For example:
  // - Check if user is authenticated
  // - Verify user owns the order
  // - Check admin permissions
  // - Validate order visibility rules
  
  // For now, we'll allow access to all orders
  // In production, you should implement proper access control
}

/**
 * Enriches order data with additional computed fields
 */
function enrichOrderData(order: ElasticPathOrder): ElasticPathOrder {
  return {
    ...order,
    meta: {
      ...order.meta,
      computed: {
        totalItems: order.relationships.items.data.length,
        averageItemValue: order.relationships.items.data.length > 0 
          ? order.subtotal.amount / order.relationships.items.data.length 
          : 0,
        hasShipping: !!order.shipping_address,
        hasTax: order.tax.amount > 0,
        formattedTotal: formatCurrency(order.total.amount, order.total.currency),
        orderAge: calculateOrderAge(order.meta?.timestamps?.created_at)
      }
    }
  };
}

/**
 * Formats currency for display
 */
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
  } catch {
    return `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;
  }
}

/**
 * Calculates order age in human-readable format
 */
function calculateOrderAge(createdAt?: string): string {
  if (!createdAt) return 'Unknown';
  
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  
  return `${Math.floor(diffDays / 365)} years ago`;
}