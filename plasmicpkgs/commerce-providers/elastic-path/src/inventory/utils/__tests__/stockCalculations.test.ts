import {
  mapStockResponseToLocationStock,
  calculateTotalStock,
  filterStockByLocation,
  getAvailableStockForLocation,
  createProductStock,
  isLowStock,
  isOutOfStock,
  getStockStatus,
} from '../stockCalculations';
import type { LocationStock, ProductStock } from '../../types';

describe('stockCalculations', () => {
  const mockStockResponse = {
    attributes: {
      locations: {
        'warehouse-1': {
          available: 10,
          allocated: 2,
          total: 12,
        },
        'store-ny': {
          available: 5,
          allocated: 1,
          total: 6,
        },
        'store-la': {
          available: 0,
          allocated: 0,
          total: 0,
        },
      },
    },
  };

  const mockLocationStocks: LocationStock[] = [
    {
      location: { id: 'warehouse-1', slug: 'warehouse-1' } as any,
      stock: {
        productId: 'prod-123',
        available: BigInt(10),
        allocated: BigInt(2),
        total: BigInt(12),
      },
    },
    {
      location: { id: 'store-ny', slug: 'store-ny' } as any,
      stock: {
        productId: 'prod-123',
        available: BigInt(5),
        allocated: BigInt(1),
        total: BigInt(6),
      },
    },
    {
      location: { id: 'store-la', slug: 'store-la' } as any,
      stock: {
        productId: 'prod-123',
        available: BigInt(0),
        allocated: BigInt(0),
        total: BigInt(0),
      },
    },
  ];

  describe('mapStockResponseToLocationStock', () => {
    it('should map API response to LocationStock array', () => {
      const result = mapStockResponseToLocationStock(mockStockResponse, 'prod-123');

      expect(result).toHaveLength(3);
      expect(result[0].location.id).toBe('warehouse-1');
      expect(result[0].stock.available).toBe(BigInt(10));
      expect(result[0].stock.allocated).toBe(BigInt(2));
      expect(result[0].stock.total).toBe(BigInt(12));
    });

    it('should handle empty response', () => {
      const emptyResponse = { attributes: { locations: {} } };
      const result = mapStockResponseToLocationStock(emptyResponse, 'prod-123');

      expect(result).toHaveLength(0);
    });

    it('should handle malformed response', () => {
      const malformedResponse = {};
      const result = mapStockResponseToLocationStock(malformedResponse, 'prod-123');

      expect(result).toHaveLength(0);
    });
  });

  describe('calculateTotalStock', () => {
    it('should calculate correct totals', () => {
      const result = calculateTotalStock(mockLocationStocks);

      expect(result.totalAvailable).toBe(15); // 10 + 5 + 0
      expect(result.totalAllocated).toBe(3);  // 2 + 1 + 0
      expect(result.totalStock).toBe(18);     // 12 + 6 + 0
    });

    it('should handle empty array', () => {
      const result = calculateTotalStock([]);

      expect(result.totalAvailable).toBe(0);
      expect(result.totalAllocated).toBe(0);
      expect(result.totalStock).toBe(0);
    });
  });

  describe('filterStockByLocation', () => {
    const mockProductStock: ProductStock = {
      productId: 'prod-123',
      locations: mockLocationStocks,
      totalAvailable: 15,
      totalAllocated: 3,
      totalStock: 18,
    };

    it('should filter by location IDs', () => {
      const result = filterStockByLocation(mockProductStock, ['warehouse-1', 'store-ny']);

      expect(result.locations).toHaveLength(2);
      expect(result.totalAvailable).toBe(15); // 10 + 5
      expect(result.totalAllocated).toBe(3);  // 2 + 1
    });

    it('should filter by location slugs', () => {
      const result = filterStockByLocation(mockProductStock, ['store-ny']);

      expect(result.locations).toHaveLength(1);
      expect(result.locations[0].location.id).toBe('store-ny');
      expect(result.totalAvailable).toBe(5);
    });

    it('should return all locations when no filter provided', () => {
      const result = filterStockByLocation(mockProductStock, []);

      expect(result.locations).toHaveLength(3);
      expect(result.totalAvailable).toBe(15);
    });
  });

  describe('getAvailableStockForLocation', () => {
    const mockProductStock: ProductStock = {
      productId: 'prod-123',
      locations: mockLocationStocks,
      totalAvailable: 15,
      totalAllocated: 3,
      totalStock: 18,
    };

    it('should return stock for specific location', () => {
      const result = getAvailableStockForLocation(mockProductStock, 'warehouse-1');
      expect(result).toBe(10);
    });

    it('should return total available when no location specified', () => {
      const result = getAvailableStockForLocation(mockProductStock);
      expect(result).toBe(15);
    });

    it('should return 0 for non-existent location', () => {
      const result = getAvailableStockForLocation(mockProductStock, 'non-existent');
      expect(result).toBe(0);
    });
  });

  describe('createProductStock', () => {
    it('should create complete ProductStock object', () => {
      const result = createProductStock('prod-123', mockStockResponse);

      expect(result.productId).toBe('prod-123');
      expect(result.locations).toHaveLength(3);
      expect(result.totalAvailable).toBe(15);
      expect(result.totalAllocated).toBe(3);
      expect(result.totalStock).toBe(18);
    });

    it('should filter by location IDs when provided', () => {
      const result = createProductStock('prod-123', mockStockResponse, ['warehouse-1']);

      expect(result.locations).toHaveLength(1);
      expect(result.totalAvailable).toBe(10);
    });
  });

  describe('isLowStock', () => {
    it('should identify low stock correctly', () => {
      expect(isLowStock(3, 5)).toBe(true);
      expect(isLowStock(5, 5)).toBe(true);
      expect(isLowStock(6, 5)).toBe(false);
      expect(isLowStock(0, 5)).toBe(false); // Out of stock, not low stock
    });
  });

  describe('isOutOfStock', () => {
    it('should identify out of stock correctly', () => {
      expect(isOutOfStock(0)).toBe(true);
      expect(isOutOfStock(-1)).toBe(true);
      expect(isOutOfStock(1)).toBe(false);
    });
  });

  describe('getStockStatus', () => {
    const thresholds = { low: 5, medium: 20 };

    it('should return correct status for each level', () => {
      expect(getStockStatus(0, thresholds)).toBe('out-of-stock');
      expect(getStockStatus(3, thresholds)).toBe('low');
      expect(getStockStatus(5, thresholds)).toBe('low');
      expect(getStockStatus(15, thresholds)).toBe('medium');
      expect(getStockStatus(25, thresholds)).toBe('high');
    });
  });
});