// Multi-location inventory types for Elastic Path - using SDK types where available
import type {
  Location,
  LocationAttributes,
  StockResponse,
  StockResponseAttributes,
  StockCreate,
  StockCreateAttributes,
  ListLocationsResponse,
  GetStockResponse,
  InventoryLocationType,
} from "@epcc-sdk/sdks-shopper";

// Re-export SDK types
export type {
  Location,
  LocationAttributes,
  StockResponse,
  StockResponseAttributes,
  StockCreate,
  StockCreateAttributes,
  ListLocationsResponse,
  GetStockResponse,
  InventoryLocationType,
};

// Extended types for component usage
export interface LocationStock {
  location: Location;
  stock: StockResponseAttributes;
  lastUpdated?: string;
}

export interface ProductStock {
  productId: string;
  locations: LocationStock[];
  totalAvailable: number;
  totalAllocated: number;
  totalStock: number;
}

// Hook options
export interface UseStockOptions {
  productIds: string[];
  locationIds?: string[];
  enabled?: boolean;
}

export interface UseLocationsOptions {
  type?: InventoryLocationType;
  enabled?: boolean;
}
