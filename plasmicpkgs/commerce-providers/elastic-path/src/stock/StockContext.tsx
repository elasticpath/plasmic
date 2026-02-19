import React, { useContext } from "react";

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

export interface StockContextValue {
  productStock: ProductStockSummary | null;
  stockLocations: StockLocationData[];
}

// Use Symbol.for + globalThis to guarantee a singleton context even if
// the bundle is loaded multiple times (e.g. CJS + ESM in the same app,
// or webpack resolving the package through different paths).
const STOCK_CTX_KEY = Symbol.for("@elasticpath/ep-stock-context");

function getStockContext(): React.Context<StockContextValue | null> {
  const g = globalThis as any;
  if (!g[STOCK_CTX_KEY]) {
    g[STOCK_CTX_KEY] = React.createContext<StockContextValue | null>(null);
  }
  return g[STOCK_CTX_KEY];
}

const StockContext = getStockContext();

export const StockContextProvider = StockContext.Provider;

export function useStockContext(): StockContextValue | null {
  return useContext(StockContext);
}
