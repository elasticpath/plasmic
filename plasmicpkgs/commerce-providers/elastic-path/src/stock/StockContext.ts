/**
 * Processed location stock data for display in Plasmic components.
 * Built from LocationStock + Location SDK types in EPStockProvider.
 */
export interface StockLocationData {
  name: string;
  slug: string;
  available: number;
  allocated: number;
  total: number;
  isInStock: boolean;
  isLowStock: boolean;
  stockStatus: "in-stock" | "low" | "out-of-stock";
}

export interface ProductStockSummary {
  totalAvailable: number;
  totalAllocated: number;
  locationCount: number;
  isInStock: boolean;
  isLowStock: boolean;
}
