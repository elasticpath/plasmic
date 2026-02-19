import { createLogger } from "../../utils/logger";

const log = createLogger("CheckoutErrors");

/**
 * Custom error classes for checkout API
 */

export class CheckoutError extends Error {
  public code: string;
  public details?: Record<string, any>;

  constructor(message: string, code: string = 'CHECKOUT_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends CheckoutError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class PaymentError extends CheckoutError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'PAYMENT_ERROR', details);
    this.name = 'PaymentError';
  }
}

export class OrderError extends CheckoutError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'ORDER_ERROR', details);
    this.name = 'OrderError';
  }
}

export class ElasticPathError extends CheckoutError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'ELASTIC_PATH_ERROR', details);
    this.name = 'ElasticPathError';
  }
}

export class StripeError extends CheckoutError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'STRIPE_ERROR', details);
    this.name = 'StripeError';
  }
}

/**
 * Error handling utilities
 */

/**
 * Handles Elastic Path API errors
 */
export function handleElasticPathError(error: any): CheckoutError {
  log.error("Elastic Path API Error", { error: error?.message || String(error) } as Record<string, unknown>);

  if (error.response?.data?.errors) {
    const epErrors = error.response.data.errors;
    const message = epErrors.map((e: any) => e.detail || e.title).join(', ');
    return new ElasticPathError(message, { originalError: error, epErrors });
  }

  if (error.response?.status === 401) {
    return new ElasticPathError('Authentication failed. Please check your API credentials.');
  }

  if (error.response?.status === 404) {
    return new ElasticPathError('Resource not found.');
  }

  if (error.response?.status >= 500) {
    return new ElasticPathError('Elastic Path service is temporarily unavailable.');
  }

  return new ElasticPathError(
    error.message || 'An unknown error occurred with Elastic Path.',
    { originalError: error }
  );
}

/**
 * Handles Stripe API errors
 */
export function handleStripeError(error: any): CheckoutError {
  log.error("Stripe API Error", { error: error?.message || String(error) } as Record<string, unknown>);

  const stripeErrorType = error.type;
  const stripeErrorCode = error.code;
  
  switch (stripeErrorType) {
    case 'card_error':
      return new PaymentError(
        error.message || 'Your card was declined.',
        { stripeError: error, code: stripeErrorCode }
      );
    
    case 'validation_error':
      return new ValidationError(
        error.message || 'Invalid payment information.',
        { stripeError: error, code: stripeErrorCode }
      );
    
    case 'api_error':
      return new StripeError(
        'Payment processing is temporarily unavailable.',
        { stripeError: error, code: stripeErrorCode }
      );
    
    case 'authentication_error':
      return new StripeError(
        'Payment authentication failed.',
        { stripeError: error, code: stripeErrorCode }
      );
    
    default:
      return new PaymentError(
        error.message || 'Payment processing failed.',
        { stripeError: error, type: stripeErrorType, code: stripeErrorCode }
      );
  }
}

/**
 * Handles validation errors with field-specific messages
 */
export function createValidationError(
  fieldErrors: Record<string, string>,
  generalMessage: string = 'Validation failed'
): ValidationError {
  return new ValidationError(generalMessage, { fieldErrors });
}

/**
 * Logs errors with appropriate level and context
 */
export function logError(error: CheckoutError, context: Record<string, any> = {}): void {
  const logData = {
    name: error.name,
    code: error.code,
    message: error.message,
    details: error.details,
    context,
    timestamp: new Date().toISOString(),
    stack: error.stack
  };

  log.error("Checkout Error", logData as Record<string, unknown>);
}

/**
 * Converts errors to API response format
 */
export function errorToApiResponse(error: CheckoutError): {
  success: false;
  error: {
    message: string;
    code: string;
    details?: Record<string, any>;
  };
} {
  return {
    success: false,
    error: {
      message: error.message,
      code: error.code,
      details: error.details
    }
  };
}

/**
 * Safely extracts user-friendly error message
 */
export function getUserErrorMessage(error: any): string {
  if (error instanceof CheckoutError) {
    return error.message;
  }

  if (error.message) {
    return error.message;
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Determines if error should be retried
 */
export function isRetryableError(error: CheckoutError): boolean {
  const retryableCodes = [
    'NETWORK_ERROR',
    'TIMEOUT_ERROR',
    'RATE_LIMIT_ERROR',
    'TEMPORARY_UNAVAILABLE'
  ];

  return retryableCodes.includes(error.code);
}

/**
 * Creates appropriate HTTP status code for error
 */
export function getHttpStatusForError(error: CheckoutError): number {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 400;
    
    case 'AUTHENTICATION_ERROR':
      return 401;
    
    case 'AUTHORIZATION_ERROR':
      return 403;
    
    case 'NOT_FOUND_ERROR':
      return 404;
    
    case 'RATE_LIMIT_ERROR':
      return 429;
    
    case 'ELASTIC_PATH_ERROR':
    case 'STRIPE_ERROR':
      return 502;
    
    case 'TIMEOUT_ERROR':
      return 504;
    
    default:
      return 500;
  }
}