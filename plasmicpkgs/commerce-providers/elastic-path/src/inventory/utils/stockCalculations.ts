import type { Location, LocationStock, ProductStock } from "../types";
import { getLocationSlug } from "../../utils/getLocationSlug";

/**
 * Stock totals aggregated across all locations
 */
export interface StockTotals {
  totalStock: number;
  totalAllocated: number;
  totalAvailable: number;
}

/**
 * Stock threshold configuration for indicators
 */
export interface StockThresholds {
  low: number;
  medium: number;
}

/**
 * Maps raw stock response from EP API to LocationStock array
 * @param stockResponse Raw response from getStock API call
 * @param productId Product ID for the stock data
 * @returns Array of LocationStock objects
 */
export function mapStockResponseToLocationStock(
  stockResponse: any,
  productId: string
): LocationStock[] {
  const locations = stockResponse?.attributes?.locations || {};
  
  return Object.entries(locations).map(([locationSlug, locationData]: [string, any]) => ({
    location: {
      id: locationSlug,
      type: "inventory_location",
      attributes: {
        name: locationSlug, // Will be enhanced with actual names elsewhere
        slug: locationSlug,
      },
    } as Location,
    stock: {
      productId,
      available: BigInt(locationData.available || 0),
      allocated: BigInt(locationData.allocated || 0),
      total: BigInt(locationData.total || 0),
    },
    lastUpdated: undefined, // Not available in current API response
  }));
}

/**
 * Calculates total stock across all locations
 * @param locationStocks Array of LocationStock objects
 * @returns Aggregated stock totals
 */
export function calculateTotalStock(locationStocks: LocationStock[]): StockTotals {
  return locationStocks.reduce(
    (totals, ls) => ({
      totalAllocated: totals.totalAllocated + Number(ls.stock.allocated || 0),
      totalAvailable: totals.totalAvailable + Number(ls.stock.available || 0),
      totalStock: totals.totalStock + Number(ls.stock.total || 0),
    }),
    { totalAllocated: 0, totalAvailable: 0, totalStock: 0 }
  );
}

/**
 * Finds available stock for a specific location
 * @param stock ProductStock object
 * @param locationSlug Location slug to find stock for
 * @returns Available stock amount, or total available if location not specified
 */
export function getAvailableStockForLocation(
  stock: ProductStock,
  locationSlug?: string
): number {
  if (!locationSlug) {
    return stock.totalAvailable;
  }

  const locationStock = stock.locations.find(ls =>
    ls.location.id === locationSlug ||
    getLocationSlug(ls.location) === locationSlug
  );

  return Number(locationStock?.stock.available || 0);
}

/**
 * Creates a ProductStock object from API response
 * @param productId Product ID
 * @param stockResponse Raw API response
 * @param locationIds Optional array of location IDs to filter by
 * @returns Complete ProductStock object
 */
export function createProductStock(
  productId: string,
  stockResponse: any,
  locationIds?: string[]
): ProductStock {
  const locationStocks = mapStockResponseToLocationStock(stockResponse, productId);
  const filteredLocations = locationIds && locationIds.length > 0
    ? locationStocks.filter(ls => {
        const slug = getLocationSlug(ls.location);
        return locationIds.includes(ls.location.id) ||
          (slug && locationIds.includes(slug));
      })
    : locationStocks;

  const totals = calculateTotalStock(filteredLocations);

  return {
    productId,
    locations: filteredLocations,
    ...totals,
  };
}

/**
 * Determines if stock is considered low based on threshold
 * @param stock Stock amount to check
 * @param threshold Low stock threshold
 * @returns True if stock is at or below threshold
 */
export function isLowStock(stock: number, threshold: number): boolean {
  return stock <= threshold && stock > 0;
}

/**
 * Determines if stock is out of stock
 * @param stock Stock amount to check
 * @returns True if stock is zero or negative
 */
export function isOutOfStock(stock: number): boolean {
  return stock <= 0;
}

/**
 * Gets stock status based on thresholds
 * @param stock Stock amount
 * @param thresholds Stock threshold configuration
 * @returns Stock status indicator
 */
export function getStockStatus(
  stock: number,
  thresholds: StockThresholds
): 'out-of-stock' | 'low' | 'medium' | 'high' {
  if (isOutOfStock(stock)) return 'out-of-stock';
  if (isLowStock(stock, thresholds.low)) return 'low';
  if (stock <= thresholds.medium) return 'medium';
  return 'high';
}