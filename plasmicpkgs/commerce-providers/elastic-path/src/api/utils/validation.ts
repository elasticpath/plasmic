import type { CustomerData, AddressData, ValidationResult } from '../../checkout/types';
import { ValidationError } from './error-handling';

/**
 * Validation utilities for checkout data
 */

/**
 * Validates customer data
 */
export function validateCustomerData(customer: CustomerData): ValidationResult {
  const errors: Record<string, string> = {};

  // Email validation
  if (!customer.email) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(customer.email)) {
    errors.email = 'Please enter a valid email address';
  }

  // Name validation
  if (!customer.name) {
    errors.name = 'Name is required';
  } else if (customer.name.length < 2) {
    errors.name = 'Name must be at least 2 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validates address data
 */
export function validateAddressData(address: AddressData, isShipping: boolean = false): ValidationResult {
  const errors: Record<string, string> = {};
  const prefix = isShipping ? 'shipping.' : 'billing.';

  // Line 1 validation
  if (!address.line_1) {
    errors[`${prefix}line_1`] = 'Address line 1 is required';
  } else if (address.line_1.length < 5) {
    errors[`${prefix}line_1`] = 'Please enter a complete address';
  }

  // City validation
  if (!address.city) {
    errors[`${prefix}city`] = 'City is required';
  } else if (address.city.length < 2) {
    errors[`${prefix}city`] = 'Please enter a valid city name';
  }

  // County/State validation (optional — not all countries use it)
  // No required check: county is optional on AddressData

  // Postal code validation
  if (!address.postcode) {
    errors[`${prefix}postcode`] = 'Postal/ZIP code is required';
  } else if (!isValidPostalCode(address.postcode, address.country)) {
    errors[`${prefix}postcode`] = 'Please enter a valid postal/ZIP code';
  }

  // Country validation
  if (!address.country) {
    errors[`${prefix}country`] = 'Country is required';
  } else if (!isValidCountryCode(address.country)) {
    errors[`${prefix}country`] = 'Please select a valid country';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validates a billing address (convenience wrapper)
 */
export function validateBillingAddress(address: AddressData): ValidationResult {
  return validateAddressData(address, false);
}

/**
 * Validates a shipping address (convenience wrapper)
 */
export function validateShippingAddress(address: AddressData): ValidationResult {
  return validateAddressData(address, true);
}

/**
 * Validates checkout form data
 */
export function validateCheckoutForm(data: {
  customer: CustomerData;
  billingAddress: AddressData;
  shippingAddress?: AddressData;
  sameAsBilling: boolean;
}): ValidationResult {
  const errors: Record<string, string> = {};

  // Validate customer data
  const customerValidation = validateCustomerData(data.customer);
  if (!customerValidation.isValid) {
    Object.assign(errors, customerValidation.errors);
  }

  // Validate billing address
  const billingValidation = validateAddressData(data.billingAddress, false);
  if (!billingValidation.isValid) {
    Object.assign(errors, billingValidation.errors);
  }

  // Validate shipping address if different from billing
  if (!data.sameAsBilling && data.shippingAddress) {
    const shippingValidation = validateAddressData(data.shippingAddress, true);
    if (!shippingValidation.isValid) {
      Object.assign(errors, shippingValidation.errors);
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validates order amount
 */
export function validateOrderAmount(amount: number, currency: string): ValidationResult {
  const errors: Record<string, string> = {};

  if (amount <= 0) {
    errors.amount = 'Order amount must be greater than zero';
  }

  if (amount > 99999999) { // $999,999.99 limit
    errors.amount = 'Order amount is too large';
  }

  if (!currency || currency.length !== 3) {
    errors.currency = 'Valid currency code is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Helper validation functions
 */

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidPostalCode(postalCode: string, country: string): boolean {
  const patterns: Record<string, RegExp> = {
    'US': /^\d{5}(-\d{4})?$/, // 12345 or 12345-6789
    'CA': /^[A-Z]\d[A-Z] \d[A-Z]\d$/, // A1A 1A1
    'GB': /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/i, // SW1A 1AA
    'DE': /^\d{5}$/, // 12345
    'FR': /^\d{5}$/, // 12345
    'AU': /^\d{4}$/, // 1234
    'JP': /^\d{3}-\d{4}$/, // 123-1234
  };

  const pattern = patterns[country.toUpperCase()];
  if (!pattern) {
    // Generic validation for unknown countries
    return /^[A-Z0-9\s-]{3,10}$/i.test(postalCode);
  }

  return pattern.test(postalCode);
}

function isValidCountryCode(country: string): boolean {
  // ISO 3166-1 alpha-2 country codes (subset)
  const validCodes = [
    'US', 'CA', 'GB', 'DE', 'FR', 'AU', 'JP', 'IT', 'ES', 'NL',
    'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IE', 'PT', 'GR',
    'PL', 'CZ', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'LT', 'LV',
    'EE', 'LU', 'MT', 'CY', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE',
    'IN', 'CN', 'KR', 'SG', 'MY', 'TH', 'ID', 'PH', 'VN', 'NZ'
  ];

  return validCodes.includes(country.toUpperCase());
}

/**
 * Sanitizes input data to prevent XSS and injection attacks
 */
export function sanitizeCustomerData(customer: CustomerData): CustomerData {
  return {
    name: sanitizeString(customer.name),
    email: sanitizeString(customer.email).toLowerCase()
  };
}

export function sanitizeAddressData(address: AddressData): AddressData {
  return {
    first_name: sanitizeString(address.first_name),
    last_name: sanitizeString(address.last_name),
    line_1: sanitizeString(address.line_1),
    line_2: address.line_2 ? sanitizeString(address.line_2) : undefined,
    city: sanitizeString(address.city),
    county: address.county ? sanitizeString(address.county) : undefined,
    postcode: sanitizeString(address.postcode),
    country: sanitizeString(address.country).toUpperCase()
  };
}

function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';

  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Validates that required environment variables are present
 */
export function validateEnvironmentVariables(): void {
  const required = [
    'EP_CLIENT_ID',
    'EP_HOST',
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required environment variables: ${missing.join(', ')}`,
      { missingVariables: missing }
    );
  }
}

/**
 * Rate limiting validation (placeholder — requires Redis or similar for production)
 */
export function validateRateLimit(
  identifier: string,
  maxRequests: number = 10,
  windowMs: number = 60000
): boolean {
  return true; // Placeholder - implement proper rate limiting
}
