import {
  validateStockAvailability,
  getStockStatusInfo,
  shouldPerformStockCheck,
  validateQuantityInput,
} from '../stockValidation';
import type { ProductStock } from '../../types';

describe('stockValidation', () => {
  const mockProductStock: ProductStock = {
    productId: 'prod-123',
    locations: [
      {
        location: { id: 'store-1', slug: 'store-1' } as any,
        stock: {
          productId: 'prod-123',
          available: BigInt(10),
          allocated: BigInt(2),
          total: BigInt(12),
        },
      },
      {
        location: { id: 'store-2', slug: 'store-2' } as any,
        stock: {
          productId: 'prod-123',
          available: BigInt(0),
          allocated: BigInt(0),
          total: BigInt(0),
        },
      },
    ],
    totalAvailable: 10,
    totalAllocated: 2,
    totalStock: 12,
  };

  describe('validateStockAvailability', () => {
    it('should validate successful stock availability', () => {
      const result = validateStockAvailability(mockProductStock, 5);

      expect(result.isValid).toBe(true);
      expect(result.isAvailable).toBe(true);
      expect(result.availableStock).toBe(10);
      expect(result.requestedQuantity).toBe(5);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should reject invalid quantity', () => {
      const result = validateStockAvailability(mockProductStock, 0);

      expect(result.isValid).toBe(false);
      expect(result.isAvailable).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be greater than 0');
    });

    it('should reject when out of stock', () => {
      const outOfStockProduct: ProductStock = {
        ...mockProductStock,
        totalAvailable: 0,
        locations: [
          {
            location: { id: 'store-1', slug: 'store-1' } as any,
            stock: {
              productId: 'prod-123',
              available: BigInt(0),
              allocated: BigInt(0),
              total: BigInt(0),
            },
          },
        ],
      };

      const result = validateStockAvailability(outOfStockProduct, 1);

      expect(result.isValid).toBe(false);
      expect(result.isAvailable).toBe(false);
      expect(result.errorMessage).toBe('This item is out of stock');
    });

    it('should reject when insufficient stock', () => {
      const result = validateStockAvailability(mockProductStock, 15);

      expect(result.isValid).toBe(false);
      expect(result.isAvailable).toBe(false);
      expect(result.errorMessage).toBe('Only 10 items available');
    });

    it('should validate for specific location', () => {
      const result = validateStockAvailability(mockProductStock, 5, 'store-1');

      expect(result.isValid).toBe(true);
      expect(result.availableStock).toBe(10);
    });

    it('should reject for out of stock location', () => {
      const result = validateStockAvailability(mockProductStock, 1, 'store-2');

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('This item is out of stock');
    });
  });

  describe('getStockStatusInfo', () => {
    it('should return out of stock status', () => {
      const result = getStockStatusInfo(0);

      expect(result.status).toBe('out-of-stock');
      expect(result.message).toBe('❌ Out of stock');
      expect(result.availableQuantity).toBe(0);
    });

    it('should return low stock status', () => {
      const result = getStockStatusInfo(3, 5);

      expect(result.status).toBe('low');
      expect(result.message).toBe('⚠️ Only 3 left');
      expect(result.availableQuantity).toBe(3);
    });

    it('should return available status', () => {
      const result = getStockStatusInfo(10, 5);

      expect(result.status).toBe('available');
      expect(result.message).toBe('✅ In stock');
      expect(result.availableQuantity).toBe(10);
    });

    it('should use default threshold', () => {
      const result = getStockStatusInfo(3); // default threshold is 5

      expect(result.status).toBe('low');
    });
  });

  describe('shouldPerformStockCheck', () => {
    it('should enable stock check when all conditions met', () => {
      const result = shouldPerformStockCheck('prod-123', mockProductStock, true);
      expect(result).toBe(true);
    });

    it('should disable when stock check is disabled', () => {
      const result = shouldPerformStockCheck('prod-123', mockProductStock, false);
      expect(result).toBe(false);
    });

    it('should disable when no product ID', () => {
      const result = shouldPerformStockCheck('', mockProductStock, true);
      expect(result).toBe(false);
    });

    it('should disable when no stock data', () => {
      const result = shouldPerformStockCheck('prod-123', null, true);
      expect(result).toBe(false);
    });
  });

  describe('validateQuantityInput', () => {
    it('should validate valid integer', () => {
      const result = validateQuantityInput(5);

      expect(result.isValid).toBe(true);
      expect(result.quantity).toBe(5);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should validate string number', () => {
      const result = validateQuantityInput('3');

      expect(result.isValid).toBe(true);
      expect(result.quantity).toBe(3);
    });

    it('should reject non-number', () => {
      const result = validateQuantityInput('abc');

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be a valid number');
    });

    it('should reject decimal number', () => {
      const result = validateQuantityInput(2.5);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be a whole number');
    });

    it('should reject zero', () => {
      const result = validateQuantityInput(0);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be greater than 0');
    });

    it('should reject negative number', () => {
      const result = validateQuantityInput(-1);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be greater than 0');
    });
  });
});