import type { APIResponse } from '../../checkout/types';

/**
 * Creates a standardized API response
 */
export function createApiResponse<T>(
  success: boolean,
  data?: T,
  error?: { message: string; code?: string; details?: Record<string, any> }
): APIResponse<T> {
  return {
    success,
    data,
    error
  };
}

/**
 * Creates a success response
 */
export function createSuccessResponse<T>(data: T): APIResponse<T> {
  return createApiResponse(true, data);
}

/**
 * Creates an error response
 */
export function createErrorResponse(
  message: string,
  code?: string,
  details?: Record<string, any>
): APIResponse {
  return createApiResponse(false, undefined, { message, code, details });
}

/**
 * Validates required environment variables
 */
export function validateEnvironment(): void {
  const required = [
    'EP_CLIENT_ID',
    'EP_HOST',
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Validates request method
 */
export function validateMethod(req: any, allowedMethods: string[]): boolean {
  return allowedMethods.includes(req.method);
}

/**
 * Extracts and validates request body
 */
export function validateRequestBody<T>(req: any, requiredFields: (keyof T)[]): T {
  const body = req.body;
  
  if (!body || typeof body !== 'object') {
    throw new Error('Request body is required');
  }

  const missing = requiredFields.filter(field => !(field in body));
  
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  return body as T;
}

/**
 * Safely parses JSON with error handling
 */
export function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Formats currency amount (in cents) for display.
 * Re-exported from the shared utility for backwards compatibility.
 */
export { formatCurrencyFromCents as formatCurrency } from "../../utils/formatCurrency";

/**
 * Converts currency amount to cents
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Converts cents to currency amount
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Generates a unique order reference
 */
export function generateOrderReference(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `EP-${timestamp}-${random}`.toUpperCase();
}

/**
 * Validates email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates phone number format (basic validation)
 */
export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
}

/**
 * Sanitizes string input to prevent XSS
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .trim();
}

/**
 * Rate limiting helper
 */
export class RateLimiter {
  private attempts: Map<string, number[]> = new Map();

  isAllowed(key: string, maxAttempts: number = 5, windowMs: number = 60000): boolean {
    const now = Date.now();
    const attempts = this.attempts.get(key) || [];
    
    // Remove attempts outside the window
    const validAttempts = attempts.filter(time => now - time < windowMs);
    
    if (validAttempts.length >= maxAttempts) {
      return false;
    }
    
    validAttempts.push(now);
    this.attempts.set(key, validAttempts);
    
    return true;
  }
}