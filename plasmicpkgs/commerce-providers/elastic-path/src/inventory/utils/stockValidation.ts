import type { ProductStock } from "../types";
import { getAvailableStockForLocation, isOutOfStock, isLowStock } from "./stockCalculations";

/**
 * Result of stock validation
 */
export interface StockValidationResult {
  isValid: boolean;
  isAvailable: boolean;
  availableStock: number;
  requestedQuantity: number;
  errorMessage?: string;
}

/**
 * Stock status information
 */
export interface StockStatusInfo {
  status: 'available' | 'low' | 'out-of-stock';
  message: string;
  availableQuantity: number;
}

/**
 * Validates if requested quantity is available in stock
 * @param stock ProductStock object
 * @param requestedQuantity Quantity being requested
 * @param locationSlug Optional location to check stock for
 * @returns Validation result with availability info
 */
export function validateStockAvailability(
  stock: ProductStock,
  requestedQuantity: number,
  locationSlug?: string
): StockValidationResult {
  if (requestedQuantity <= 0) {
    return {
      isValid: false,
      isAvailable: false,
      availableStock: 0,
      requestedQuantity,
      errorMessage: "Quantity must be greater than 0",
    };
  }

  const availableStock = getAvailableStockForLocation(stock, locationSlug);

  if (isOutOfStock(availableStock)) {
    return {
      isValid: false,
      isAvailable: false,
      availableStock,
      requestedQuantity,
      errorMessage: "This item is out of stock",
    };
  }

  if (availableStock < requestedQuantity) {
    return {
      isValid: false,
      isAvailable: false,
      availableStock,
      requestedQuantity,
      errorMessage: `Only ${availableStock} items available`,
    };
  }

  return {
    isValid: true,
    isAvailable: true,
    availableStock,
    requestedQuantity,
  };
}

/**
 * Gets user-friendly stock status message
 * @param availableStock Available stock quantity
 * @param lowStockThreshold Threshold for low stock warning
 * @returns Stock status information
 */
export function getStockStatusInfo(
  availableStock: number,
  lowStockThreshold: number = 5
): StockStatusInfo {
  if (isOutOfStock(availableStock)) {
    return {
      status: 'out-of-stock',
      message: '❌ Out of stock',
      availableQuantity: availableStock,
    };
  }

  if (isLowStock(availableStock, lowStockThreshold)) {
    return {
      status: 'low',
      message: `⚠️ Only ${availableStock} left`,
      availableQuantity: availableStock,
    };
  }

  return {
    status: 'available',
    message: '✅ In stock',
    availableQuantity: availableStock,
  };
}

/**
 * Checks if stock checking should be enabled for a product
 * @param productId Product ID to check
 * @param stock Stock data (may be null during loading)
 * @param enableStockCheck User preference for stock checking
 * @returns Whether stock validation should be performed
 */
export function shouldPerformStockCheck(
  productId: string,
  stock: ProductStock | null,
  enableStockCheck: boolean
): boolean {
  return enableStockCheck && !!productId && !!stock;
}

/**
 * Validates quantity input from user
 * @param quantity User input quantity
 * @returns Validation result with parsed quantity
 */
export function validateQuantityInput(quantity: any): {
  isValid: boolean;
  quantity: number;
  errorMessage?: string;
} {
  const parsed = Number(quantity);

  if (isNaN(parsed)) {
    return {
      isValid: false,
      quantity: 0,
      errorMessage: "Quantity must be a valid number",
    };
  }

  if (!Number.isInteger(parsed)) {
    return {
      isValid: false,
      quantity: parsed,
      errorMessage: "Quantity must be a whole number",
    };
  }

  if (parsed < 1) {
    return {
      isValid: false,
      quantity: parsed,
      errorMessage: "Quantity must be greater than 0",
    };
  }

  return {
    isValid: true,
    quantity: parsed,
  };
}