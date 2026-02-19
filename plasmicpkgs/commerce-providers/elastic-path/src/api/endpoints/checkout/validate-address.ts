import type { AddressData } from "../../../checkout/types";
import { createLogger } from "../../../utils/logger";
import {
  createSuccessResponse,
  createErrorResponse,
  validateMethod,
  validateRequestBody
} from "../../utils/api-helpers";

const log = createLogger("validateAddress");
import { 
  validateBillingAddress,
  validateShippingAddress 
} from "../../utils/validation";
import { 
  logError, 
  getHttpStatusForError,
  ValidationError 
} from "../../utils/error-handling";

interface ValidateAddressAPI {
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

/**
 * API endpoint to validate and normalize addresses
 * POST /api/checkout/validate-address
 */
export default async function validateAddressHandler(req: any, res: any) {
  try {
    // Validate HTTP method
    if (!validateMethod(req, ['POST'])) {
      return res.status(405).json(createErrorResponse('Method not allowed'));
    }

    // Validate and extract request body
    const body = validateRequestBody<ValidateAddressAPI['body']>(req, [
      'address'
    ]);

    const { address, type = 'shipping' } = body;

    if (!address || typeof address !== 'object') {
      throw new ValidationError('Valid address object is required');
    }

    // Perform basic validation based on address type
    const validation = type === 'billing' 
      ? validateBillingAddress(address)
      : validateShippingAddress(address);

    let normalizedAddress: AddressData | undefined;
    let suggestions: AddressData[] | undefined;

    // If basic validation passes, attempt normalization
    if (validation.isValid) {
      try {
        const normalizationResult = await normalizeAddress(address);
        normalizedAddress = normalizationResult.normalized;
        suggestions = normalizationResult.suggestions;
      } catch (error) {
        // Normalization failure doesn't make the address invalid
        log.warn("Address normalization failed", { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>);
      }
    }

    // Log validation attempt
    log.info(`Address validation completed: ${validation.isValid ? 'valid' : 'invalid'}`);

    return res.status(200).json(createSuccessResponse<ValidateAddressAPI['data']>({
      isValid: validation.isValid,
      errors: validation.isValid ? undefined : validation.errors,
      normalized: normalizedAddress,
      suggestions: suggestions
    }));

  } catch (error) {
    log.error("Address validation error", { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>);

    const checkoutError = error instanceof ValidationError 
      ? error 
      : new ValidationError('Address validation failed');

    // Log the error with context
    logError(checkoutError, {
      endpoint: 'validate-address',
      addressType: req.body?.type,
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
 * Normalize address using external service (placeholder implementation)
 */
async function normalizeAddress(address: AddressData): Promise<{
  normalized?: AddressData;
  suggestions?: AddressData[];
}> {
  // This is a placeholder implementation
  // In a real application, you would integrate with an address validation service like:
  // - Google Maps Geocoding API
  // - USPS Address Validation
  // - Loqate/PCA Predict
  // - SmartyStreets
  // - Here Geocoding API

  try {
    // For now, just return basic normalization
    const normalized: AddressData = {
      ...address,
      // Normalize common formatting
      first_name: capitalizeWords(address.first_name || ''),
      last_name: capitalizeWords(address.last_name || ''),
      line_1: capitalizeWords(address.line_1 || ''),
      line_2: address.line_2 ? capitalizeWords(address.line_2) : undefined,
      city: capitalizeWords(address.city || ''),
      county: address.county ? capitalizeWords(address.county) : undefined,
      country: address.country?.toUpperCase() || '',
      postcode: normalizePostalCode(address.postcode || '', address.country || '')
    };

    return { normalized };

  } catch (error) {
    log.error("Address normalization error", { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>);
    throw error;
  }
}

/**
 * Capitalize words in a string
 */
function capitalizeWords(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim();
}

/**
 * Normalize postal codes based on country
 */
function normalizePostalCode(postcode: string, country: string): string {
  const cleanCode = postcode.replace(/\s+/g, '').toUpperCase();
  
  switch (country.toUpperCase()) {
    case 'US':
      // US ZIP codes: 12345 or 12345-6789
      if (/^\d{5}$/.test(cleanCode)) {
        return cleanCode;
      }
      if (/^\d{9}$/.test(cleanCode)) {
        return `${cleanCode.slice(0, 5)}-${cleanCode.slice(5)}`;
      }
      break;
      
    case 'CA':
      // Canadian postal codes: A1A 1A1
      if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(cleanCode)) {
        return `${cleanCode.slice(0, 3)} ${cleanCode.slice(3)}`;
      }
      break;
      
    case 'GB':
      // UK postal codes: various formats
      if (/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(cleanCode)) {
        // Ensure proper spacing
        const match = cleanCode.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/i);
        if (match) {
          return `${match[1]} ${match[2]}`;
        }
      }
      break;
      
    default:
      // For other countries, just return the cleaned code
      return cleanCode;
  }
  
  // If no specific formatting applied, return cleaned code
  return cleanCode;
}

/**
 * Validate postal code format for specific countries
 */
function validatePostalCodeFormat(postcode: string, country: string): boolean {
  const patterns: Record<string, RegExp> = {
    'US': /^\d{5}(-\d{4})?$/,
    'CA': /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i,
    'GB': /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
    'AU': /^\d{4}$/,
    'DE': /^\d{5}$/,
    'FR': /^\d{5}$/,
    'IT': /^\d{5}$/,
    'ES': /^\d{5}$/,
    'NL': /^\d{4}\s?[A-Z]{2}$/i,
    'SE': /^\d{3}\s?\d{2}$/,
    'NO': /^\d{4}$/,
    'DK': /^\d{4}$/
  };

  const pattern = patterns[country.toUpperCase()];
  return pattern ? pattern.test(postcode) : true; // Allow unknown countries
}

/**
 * Get address validation suggestions based on partial input
 */
async function getAddressSuggestions(partialAddress: Partial<AddressData>): Promise<AddressData[]> {
  // This would typically call an address autocomplete service
  // For now, return empty array
  return [];
}

/**
 * Validate address against known patterns and business rules
 */
function validateAddressBusinessRules(address: AddressData): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  // Validate postal code format
  if (address.postcode && address.country) {
    if (!validatePostalCodeFormat(address.postcode, address.country)) {
      errors.postcode = `Invalid postal code format for ${address.country}`;
    }
  }

  // Check for PO Box restrictions (if needed)
  if (address.line_1 && /P\.?O\.?\s*BOX/i.test(address.line_1)) {
    // Some shipping methods don't allow PO Boxes
    // This would depend on your business rules
  }

  // Validate state/county for US addresses
  if (address.country === 'US' && address.county) {
    // Could validate against known US state codes
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}