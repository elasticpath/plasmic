/**
 * Standard error codes for the EP package
 */
export enum EPErrorCode {
  // Stock related errors
  STOCK_UNAVAILABLE = 'STOCK_UNAVAILABLE',
  STOCK_INSUFFICIENT = 'STOCK_INSUFFICIENT',
  STOCK_FETCH_FAILED = 'STOCK_FETCH_FAILED',
  
  // Cart related errors
  CART_INVALID_QUANTITY = 'CART_INVALID_QUANTITY',
  CART_ITEM_INVALID = 'CART_ITEM_INVALID',
  CART_ADD_FAILED = 'CART_ADD_FAILED',
  
  // Product related errors
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  PRODUCT_NOT_BUNDLE = 'PRODUCT_NOT_BUNDLE',
  PRODUCT_INVALID = 'PRODUCT_INVALID',
  
  // Location related errors
  LOCATION_NOT_FOUND = 'LOCATION_NOT_FOUND',
  LOCATION_FETCH_FAILED = 'LOCATION_FETCH_FAILED',
  
  // API related errors
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Standardized error interface
 */
export interface EPError {
  code: EPErrorCode;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

/**
 * Creates a standardized EP error
 * @param code Error code
 * @param message Error message
 * @param details Optional additional details
 * @returns Standardized EP error
 */
export function createEPError(
  code: EPErrorCode,
  message: string,
  details?: Record<string, any>
): EPError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a stock-related error
 * @param message Error message
 * @param availableStock Available stock amount
 * @param requestedQuantity Requested quantity
 * @returns Stock error
 */
export function createStockError(
  message: string,
  availableStock: number,
  requestedQuantity: number
): EPError {
  const code = availableStock === 0 
    ? EPErrorCode.STOCK_UNAVAILABLE 
    : EPErrorCode.STOCK_INSUFFICIENT;

  return createEPError(code, message, {
    availableStock,
    requestedQuantity,
  });
}

/**
 * Creates a cart validation error
 * @param message Error message
 * @param itemData Invalid item data
 * @returns Cart error
 */
export function createCartValidationError(
  message: string,
  itemData?: Record<string, any>
): EPError {
  return createEPError(EPErrorCode.CART_ITEM_INVALID, message, {
    itemData,
  });
}

/**
 * Handles and standardizes API errors
 * @param error Raw error from API call
 * @param context Context where error occurred
 * @returns Standardized EP error
 */
export function handleAPIError(
  error: unknown,
  context: string = 'API call'
): EPError {
  if (error instanceof Error) {
    // Network/connection errors
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return createEPError(
        EPErrorCode.NETWORK_ERROR,
        `Network error during ${context}: ${error.message}`,
        { originalError: error.message }
      );
    }

    // Generic API errors
    return createEPError(
      EPErrorCode.API_ERROR,
      `API error during ${context}: ${error.message}`,
      { originalError: error.message }
    );
  }

  // Unknown error types
  return createEPError(
    EPErrorCode.UNKNOWN_ERROR,
    `Unknown error during ${context}`,
    { originalError: String(error) }
  );
}

/**
 * Formats error message for user display
 * @param error EP error object
 * @returns User-friendly error message
 */
export function formatUserErrorMessage(error: EPError): string {
  switch (error.code) {
    case EPErrorCode.STOCK_UNAVAILABLE:
      return "This item is currently out of stock";
      
    case EPErrorCode.STOCK_INSUFFICIENT:
      const available = error.details?.availableStock;
      return available ? `Only ${available} items available` : "Not enough stock available";
      
    case EPErrorCode.CART_INVALID_QUANTITY:
      return "Please enter a valid quantity";
      
    case EPErrorCode.PRODUCT_NOT_FOUND:
      return "Product not found";
      
    case EPErrorCode.LOCATION_NOT_FOUND:
      return "Location not found";
      
    case EPErrorCode.NETWORK_ERROR:
      return "Network connection error. Please try again.";
      
    default:
      return error.message || "An unexpected error occurred";
  }
}

/**
 * Checks if an error is user-recoverable
 * @param error EP error object
 * @returns True if user can potentially recover from this error
 */
export function isRecoverableError(error: EPError): boolean {
  const recoverableCodes = [
    EPErrorCode.CART_INVALID_QUANTITY,
    EPErrorCode.STOCK_INSUFFICIENT,
    EPErrorCode.NETWORK_ERROR,
  ];
  
  return recoverableCodes.includes(error.code);
}

/**
 * Logs error for debugging purposes
 * @param error EP error object
 * @param context Additional context for logging
 */
export function logError(error: EPError, context?: string): void {
  const logMessage = `[EP Error] ${error.code}: ${error.message}`;
  const logData = {
    error,
    context,
    timestamp: error.timestamp,
  };

  console.error(logMessage, logData);
}

/**
 * Creates an error for missing form context
 * @param componentName Name of component missing form context
 * @returns Form context error
 */
export function createFormContextError(componentName: string): EPError {
  return createEPError(
    EPErrorCode.CART_ITEM_INVALID,
    `${componentName} must be used within a ProductProvider that provides a form context`
  );
}