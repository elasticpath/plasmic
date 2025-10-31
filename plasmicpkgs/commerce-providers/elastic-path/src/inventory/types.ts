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

// Component props
export interface StockIndicatorProps {
  stock: number;
  threshold?: {
    low: number;
    medium: number;
  };
  showExact?: boolean;
}

export interface LocationSelectorProps {
  locations: Location[];
  selectedLocationId?: string;
  onLocationChange: (locationId: string) => void;
  loading?: boolean;
  placeholder?: string;
}

export interface MultiLocationStockProps {
  productId?: string;
  showLocationSelector?: boolean;
  maxLocationsDisplay?: number;
  showStockNumbers?: boolean;
  lowStockThreshold?: number;
}

export interface LocationAwareAddToCartProps {
  children?: React.ReactNode;
  requireLocationSelection?: boolean;
  defaultLocationId?: string;
  onLocationRequired?: () => void;
}