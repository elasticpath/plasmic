import {
  getLocationDisplayName,
  formatStockMessage,
  getStockIndicatorStyle,
  formatStockQuantity,
  createStockSummaryMessage,
  shouldShowMoreLocationsIndicator,
  createMoreLocationsText,
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

  describe('getStockIndicatorStyle', () => {
    it('should return out of stock style for zero stock', () => {
      const result = getStockIndicatorStyle(0);

      expect(result.backgroundColor).toBe('#d32f2f');
      expect(result.text).toBe('Out of Stock');
    });

    it('should return low stock style', () => {
      const result = getStockIndicatorStyle(3, 5, 20);

      expect(result.backgroundColor).toBe('#f57c00');
      expect(result.text).toBe('Low Stock');
    });

    it('should return medium stock style', () => {
      const result = getStockIndicatorStyle(15, 5, 20);

      expect(result.backgroundColor).toBe('#ffeb3b');
      expect(result.text).toBe('Limited Stock');
    });

    it('should return high stock style', () => {
      const result = getStockIndicatorStyle(25, 5, 20);

      expect(result.backgroundColor).toBe('#388e3c');
      expect(result.text).toBe('In Stock');
    });

    it('should use default thresholds', () => {
      const lowResult = getStockIndicatorStyle(3);
      const mediumResult = getStockIndicatorStyle(15);
      const highResult = getStockIndicatorStyle(25);

      expect(lowResult.text).toBe('Low Stock');
      expect(mediumResult.text).toBe('Limited Stock');
      expect(highResult.text).toBe('In Stock');
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

  describe('createStockSummaryMessage', () => {
    it('should create basic summary', () => {
      const result = createStockSummaryMessage(15);
      expect(result).toBe('Total Available: 15 units');
    });

    it('should include allocation info', () => {
      const result = createStockSummaryMessage(15, 3);
      expect(result).toBe('Total Available: 15 units (3 allocated)');
    });

    it('should include location count', () => {
      const result = createStockSummaryMessage(15, 3, 4);
      expect(result).toBe('Total Available: 15 units (3 allocated) across 4 locations');
    });

    it('should handle single location', () => {
      const result = createStockSummaryMessage(15, 0, 1);
      expect(result).toBe('Total Available: 15 units');
    });
  });

  describe('shouldShowMoreLocationsIndicator', () => {
    it('should show when more locations exist and none selected', () => {
      const result = shouldShowMoreLocationsIndicator(5, 3);
      expect(result).toBe(true);
    });

    it('should not show when location is selected', () => {
      const result = shouldShowMoreLocationsIndicator(5, 3, 'loc-1');
      expect(result).toBe(false);
    });

    it('should not show when all locations displayed', () => {
      const result = shouldShowMoreLocationsIndicator(3, 3);
      expect(result).toBe(false);
    });

    it('should not show when fewer locations than display limit', () => {
      const result = shouldShowMoreLocationsIndicator(2, 3);
      expect(result).toBe(false);
    });
  });

  describe('createMoreLocationsText', () => {
    it('should create singular text', () => {
      const result = createMoreLocationsText(4, 3);
      expect(result).toBe('+1 more location available');
    });

    it('should create plural text', () => {
      const result = createMoreLocationsText(7, 3);
      expect(result).toBe('+4 more locations available');
    });

    it('should handle edge case', () => {
      const result = createMoreLocationsText(3, 3);
      expect(result).toBe('+0 more locations available');
    });
  });
});