import type { Location } from "../types";

/**
 * Stock indicator style configuration
 */
export interface StockIndicatorStyle {
  color: string;
  backgroundColor: string;
  text: string;
}

/**
 * Gets display name for a location, with fallback options
 * @param location Location object from API
 * @param locations Array of all locations (for slug matching)
 * @param fallback Fallback text if name not found
 * @returns User-friendly location name
 */
export function getLocationDisplayName(
  location: any,
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
    (loc.attributes as any)?.slug === location.id
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
 * Gets stock indicator styling based on stock level
 * @param stock Current stock level
 * @param lowThreshold Low stock threshold
 * @param mediumThreshold Medium stock threshold
 * @returns Style configuration for stock indicator
 */
export function getStockIndicatorStyle(
  stock: number,
  lowThreshold: number = 5,
  mediumThreshold: number = 20
): StockIndicatorStyle {
  if (stock <= 0) {
    return {
      color: '#fff',
      backgroundColor: '#d32f2f',
      text: 'Out of Stock',
    };
  }

  if (stock <= lowThreshold) {
    return {
      color: '#fff',
      backgroundColor: '#f57c00',
      text: 'Low Stock',
    };
  }

  if (stock <= mediumThreshold) {
    return {
      color: '#333',
      backgroundColor: '#ffeb3b',
      text: 'Limited Stock',
    };
  }

  return {
    color: '#fff',
    backgroundColor: '#388e3c',
    text: 'In Stock',
  };
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
    if (stock <= 5) return 'Low Stock';
    return 'In Stock';
  }

  if (stock <= 0) return '0 units';
  if (stock === 1) return '1 unit';
  return `${stock} units`;
}

/**
 * Creates a summary message for total stock across locations
 * @param totalAvailable Total available stock
 * @param totalAllocated Total allocated stock
 * @param locationCount Number of locations with stock
 * @returns Summary message
 */
export function createStockSummaryMessage(
  totalAvailable: number,
  totalAllocated: number = 0,
  locationCount: number = 0
): string {
  let message = `Total Available: ${totalAvailable} units`;
  
  if (totalAllocated > 0) {
    message += ` (${totalAllocated} allocated)`;
  }
  
  if (locationCount > 1) {
    message += ` across ${locationCount} locations`;
  }
  
  return message;
}

/**
 * Determines if more locations indicator should be shown
 * @param totalLocations Total number of locations with stock
 * @param displayedLocations Number of locations currently displayed
 * @param selectedLocationId Currently selected location (if any)
 * @returns Whether to show "more locations" indicator
 */
export function shouldShowMoreLocationsIndicator(
  totalLocations: number,
  displayedLocations: number,
  selectedLocationId?: string
): boolean {
  return !selectedLocationId && totalLocations > displayedLocations;
}

/**
 * Creates "more locations" text
 * @param totalLocations Total number of locations
 * @param displayedLocations Number currently displayed
 * @returns Text for more locations indicator
 */
export function createMoreLocationsText(
  totalLocations: number,
  displayedLocations: number
): string {
  const remaining = totalLocations - displayedLocations;
  return `+${remaining} more location${remaining === 1 ? '' : 's'} available`;
}