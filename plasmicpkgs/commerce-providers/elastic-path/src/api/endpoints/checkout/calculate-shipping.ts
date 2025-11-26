import { getShippingOptions } from "@epcc-sdk/sdks-shopper";
import type { AddressData, ShippingRate } from "../../../checkout/types";
import { 
  createSuccessResponse, 
  createErrorResponse, 
  validateMethod, 
  validateRequestBody 
} from "../../utils/api-helpers";
import { 
  validateShippingAddress,
  validateEnvironmentVariables 
} from "../../utils/validation";
import { 
  handleElasticPathError, 
  logError, 
  getHttpStatusForError,
  CheckoutError,
  ValidationError 
} from "../../utils/error-handling";

interface CalculateShippingAPI {
  body: {
    cartId: string;
    shippingAddress: AddressData;
  };
  data: {
    shippingRates: ShippingRate[];
  };
}

/**
 * API endpoint to calculate shipping rates for a cart
 * POST /api/checkout/calculate-shipping
 */
export default async function calculateShippingHandler(req: any, res: any) {
  try {
    // Validate environment
    validateEnvironmentVariables();

    // Validate HTTP method
    if (!validateMethod(req, ['POST'])) {
      return res.status(405).json(createErrorResponse('Method not allowed'));
    }

    // Validate and extract request body
    const body = validateRequestBody<CalculateShippingAPI['body']>(req, [
      'cartId',
      'shippingAddress'
    ]);

    const { cartId, shippingAddress } = body;

    // Validate cart ID
    if (!cartId || typeof cartId !== 'string' || cartId.length < 1) {
      throw new ValidationError('Valid cart ID is required');
    }

    // Validate shipping address
    const addressValidation = validateShippingAddress(shippingAddress);
    if (!addressValidation.isValid) {
      throw new ValidationError('Invalid shipping address', { 
        fieldErrors: addressValidation.errors 
      });
    }

    // Initialize Elastic Path client
    const client = {
      settings: {
        application_id: process.env.EP_CLIENT_ID!,
        host: process.env.EP_HOST || 'https://api.moltin.com'
      }
    };

    // Get shipping options from Elastic Path
    const shippingResponse = await getShippingOptions({
      client,
      path: { cartID: cartId },
      body: {
        data: {
          shipping_address: {
            first_name: shippingAddress.first_name,
            last_name: shippingAddress.last_name,
            line_1: shippingAddress.line_1,
            line_2: shippingAddress.line_2 || '',
            city: shippingAddress.city,
            county: shippingAddress.county || '',
            country: shippingAddress.country,
            postcode: shippingAddress.postcode
          }
        }
      }
    });

    if (!shippingResponse.data || !shippingResponse.data.data) {
      throw new CheckoutError('No shipping options available');
    }

    // Transform shipping options to our format
    const shippingRates: ShippingRate[] = shippingResponse.data.data.map((option: any) => ({
      id: option.id,
      name: option.name || option.description || 'Shipping',
      description: option.description || '',
      amount: option.price?.amount || 0,
      currency: option.price?.currency || 'USD',
      delivery_time: option.delivery_time || null,
      service_level: option.service_level || 'standard',
      carrier: option.carrier || null
    }));

    // Log successful calculation
    console.log(`Shipping calculated for cart: ${cartId}, found ${shippingRates.length} options`);

    return res.status(200).json(createSuccessResponse<CalculateShippingAPI['data']>({
      shippingRates
    }));

  } catch (error) {
    console.error('Calculate shipping error:', error);

    let checkoutError: CheckoutError;

    if (error instanceof CheckoutError) {
      checkoutError = error;
    } else {
      // Handle Elastic Path specific errors
      checkoutError = handleElasticPathError(error);
    }

    // Log the error with context
    logError(checkoutError, {
      endpoint: 'calculate-shipping',
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
 * Transforms Elastic Path shipping option to our format
 */
function transformShippingOption(epOption: any): ShippingRate {
  return {
    id: epOption.id,
    name: epOption.name || epOption.description || 'Shipping',
    description: epOption.description || '',
    amount: epOption.price?.amount || 0,
    currency: epOption.price?.currency || 'USD',
    delivery_time: parseDeliveryTime(epOption.delivery_time),
    service_level: mapServiceLevel(epOption.service_level),
    carrier: epOption.carrier || null
  };
}

/**
 * Parse delivery time from various formats
 */
function parseDeliveryTime(deliveryTime: any): string | null {
  if (!deliveryTime) return null;
  
  if (typeof deliveryTime === 'string') {
    return deliveryTime;
  }
  
  if (typeof deliveryTime === 'object') {
    // Handle range: { min: 1, max: 3, unit: 'days' }
    if (deliveryTime.min && deliveryTime.max && deliveryTime.unit) {
      return `${deliveryTime.min}-${deliveryTime.max} ${deliveryTime.unit}`;
    }
    
    // Handle single value: { value: 2, unit: 'days' }
    if (deliveryTime.value && deliveryTime.unit) {
      return `${deliveryTime.value} ${deliveryTime.unit}`;
    }
  }
  
  return String(deliveryTime);
}

/**
 * Map service level to standardized values
 */
function mapServiceLevel(serviceLevel: string): string {
  const levelMap: Record<string, string> = {
    'same_day': 'same_day',
    'next_day': 'next_day',
    'express': 'express',
    'standard': 'standard',
    'economy': 'economy',
    'ground': 'standard',
    'air': 'express',
    'overnight': 'next_day'
  };
  
  return levelMap[serviceLevel?.toLowerCase()] || 'standard';
}

/**
 * Validates shipping rate data
 */
function validateShippingRate(rate: any): boolean {
  return !!(
    rate.id &&
    rate.name &&
    typeof rate.amount === 'number' &&
    rate.amount >= 0 &&
    rate.currency &&
    rate.currency.length === 3
  );
}

/**
 * Sorts shipping rates by price and service level
 */
function sortShippingRates(rates: ShippingRate[]): ShippingRate[] {
  const serviceLevelOrder = ['same_day', 'next_day', 'express', 'standard', 'economy'];
  
  return rates.sort((a, b) => {
    // First sort by service level
    const aIndex = serviceLevelOrder.indexOf(a.service_level);
    const bIndex = serviceLevelOrder.indexOf(b.service_level);
    
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    
    // Then sort by price
    return a.amount - b.amount;
  });
}