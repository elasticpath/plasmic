import {
  getLocationDisplayName,
  formatStockMessage,
  formatStockQuantity,
} from '../displayHelpers';
import type { Location } from '../../types';

describe('displayHelpers', () => {
  const mockLocations: Location[] = [
    {
      id: 'loc-1',
      type: 'inventory_location',
      attributes: { name: 'New York Store' } as any,
    },
    {
      id: 'loc-2',
      type: 'inventory_location',
      attributes: { name: 'Los Angeles Store', slug: 'la-store' } as any,
    },
  ];

  describe('getLocationDisplayName', () => {
    it('should return direct name from location attributes', () => {
      const location = { attributes: { name: 'Direct Name' } };
      const result = getLocationDisplayName(location);

      expect(result).toBe('Direct Name');
    });

    it('should find name from locations array by ID', () => {
      const location = { id: 'loc-1' };
      const result = getLocationDisplayName(location, mockLocations);

      expect(result).toBe('New York Store');
    });

    it('should find name from locations array by slug', () => {
      const location = { id: 'la-store' };
      const result = getLocationDisplayName(location, mockLocations);

      expect(result).toBe('Los Angeles Store');
    });

    it('should use fallback when no name found', () => {
      const location = { id: 'unknown-loc' };
      const result = getLocationDisplayName(location, mockLocations, 'Fallback Name');

      expect(result).toBe('Fallback Name');
    });

    it('should use location ID when no name or fallback', () => {
      const location = { id: 'unknown-loc' };
      const result = getLocationDisplayName(location, mockLocations);

      expect(result).toBe('unknown-loc');
    });

    it('should handle completely unknown location', () => {
      const location = {};
      const result = getLocationDisplayName(location, []);

      expect(result).toBe('Unknown Location');
    });
  });

  describe('formatStockMessage', () => {
    it('should format stock without allocation', () => {
      const result = formatStockMessage(10);
      expect(result).toBe('10 available');
    });

    it('should format stock with allocation', () => {
      const result = formatStockMessage(10, 3);
      expect(result).toBe('10 available (3 allocated)');
    });

    it('should handle zero allocation', () => {
      const result = formatStockMessage(5, 0);
      expect(result).toBe('5 available');
    });
  });

  describe('formatStockQuantity', () => {
    it('should show exact quantities when enabled', () => {
      expect(formatStockQuantity(0, true)).toBe('0 units');
      expect(formatStockQuantity(1, true)).toBe('1 unit');
      expect(formatStockQuantity(5, true)).toBe('5 units');
    });

    it('should show indicators when exact disabled', () => {
      expect(formatStockQuantity(0, false)).toBe('Out of Stock');
      expect(formatStockQuantity(3, false)).toBe('Low Stock');
      expect(formatStockQuantity(10, false)).toBe('In Stock');
    });

    it('should default to exact quantities', () => {
      expect(formatStockQuantity(5)).toBe('5 units');
    });
  });
});