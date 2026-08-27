import { DEFAULT_LOW_STOCK_THRESHOLD } from "../../const";
import type { Location } from "../types";

/**
 * Gets display name for a location, with fallback options
 * @param location Location object from API
 * @param locations Array of all locations (for slug matching)
 * @param fallback Fallback text if name not found
 * @returns User-friendly location name
 */
export function getLocationDisplayName(
  location: Location,
  locations: Location[] = [],
  fallback?: string
): string {
  // Try direct name access first
  if (location.attributes?.name) {
    return location.attributes.name;
  }

  // Try to find matching location by ID or slug
  const matchingLocation = locations.find(loc =>
    loc.id === location.id ||
    loc.attributes?.slug === location.id
  );

  if (matchingLocation?.attributes?.name) {
    return matchingLocation.attributes.name;
  }

  // Use fallback or location ID
  return fallback || location.id || 'Unknown Location';
}

/**
 * Formats stock display message with allocated stock info
 * @param availableStock Available stock quantity
 * @param allocatedStock Allocated/reserved stock quantity
 * @returns Formatted stock message
 */
export function formatStockMessage(
  availableStock: number,
  allocatedStock: number = 0
): string {
  let message = `${availableStock} available`;
  
  if (allocatedStock > 0) {
    message += ` (${allocatedStock} allocated)`;
  }
  
  return message;
}

/**
 * Formats stock quantity for display with proper units
 * @param stock Stock quantity
 * @param showExact Whether to show exact numbers or just indicators
 * @returns Formatted stock text
 */
export function formatStockQuantity(stock: number, showExact: boolean = true): string {
  if (!showExact) {
    if (stock <= 0) return 'Out of Stock';
    if (stock <= DEFAULT_LOW_STOCK_THRESHOLD) return 'Low Stock';
    return 'In Stock';
  }

  if (stock <= 0) return '0 units';
  if (stock === 1) return '1 unit';
  return `${stock} units`;
}
