import {
  resolveLocationSlug,
  extractCartItemFromForm,
  validateAndParseQuantity,
} from '../cartDataBuilder';
import type { BundleConfiguration } from '@epcc-sdk/sdks-shopper';
import type { Product } from '../../../types/product';

describe('cartDataBuilder', () => {
  const mockBundleConfig: BundleConfiguration = {
    selected_options: {
      'component-1': {
        'option-1': 2,
      },
    },
  };

  const mockProduct = {
    id: 'prod-123',
    variants: [
      { id: 'variant-1' },
      { id: 'variant-2' },
    ],
  };

  describe('resolveLocationSlug', () => {
    it('should prioritize form context value', () => {
      const formValues = { SelectedLocationSlug: 'form-location' };
      const props = { locationSlug: 'prop-location', locationId: 'prop-id' };

      const result = resolveLocationSlug(formValues, props);
      expect(result).toBe('form-location');
    });

    it('should use prop slug when no form value', () => {
      const formValues = {};
      const props = { locationSlug: 'prop-location', locationId: 'prop-id' };

      const result = resolveLocationSlug(formValues, props);
      expect(result).toBe('prop-location');
    });

    it('should use prop ID as fallback', () => {
      const formValues = {};
      const props = { locationId: 'prop-id' };

      const result = resolveLocationSlug(formValues, props);
      expect(result).toBe('prop-id');
    });

    it('should return undefined when no location info', () => {
      const formValues = {};
      const props = {};

      const result = resolveLocationSlug(formValues, props);
      expect(result).toBeUndefined();
    });
  });

  describe('extractCartItemFromForm', () => {
    it('resolves the chosen child product, the options behind it and the location', () => {
      const product = {
        id: 'base-1',
        variations: [
          { id: 'var-size', name: 'Size', options: [{ id: 'opt-s', name: 'Small' }] },
        ],
        childProducts: [{ id: 'child-s' }, { id: 'child-m' }],
      };

      const args = extractCartItemFromForm(
        {
          ProductVariant: 'child-m',
          ProductQuantity: 3,
          'variation_var-size': 'Small',
          SelectedLocationSlug: 'warehouse-north',
          BundleConfiguration: mockBundleConfig,
        },
        product as unknown as Product,
        {}
      );

      expect(args).toEqual({
        productId: 'child-m',
        quantity: 3,
        location: 'warehouse-north',
        bundleConfiguration: mockBundleConfig,
        customInputs: {
          _selectedOptions: [{ id: 'var-size', name: 'Size', value: 'Small' }],
        },
      });
    });
  });

    it('falls back to the first child product, then to the product itself', () => {
      const withChildren = {
        id: 'base-1',
        variations: [],
        childProducts: [{ id: 'child-s' }, { id: 'child-m' }],
      };
      expect(extractCartItemFromForm({}, withChildren as unknown as Product, {}).productId).toBe(
        'child-s'
      );

      const simple = { id: 'prod-1', variations: [], childProducts: [] };
      expect(extractCartItemFromForm({}, simple as unknown as Product, {}).productId).toBe('prod-1');
      expect(extractCartItemFromForm({}, simple as unknown as Product, {}).quantity).toBe(1);
    });

  describe('validateAndParseQuantity', () => {
    it('should validate valid number', () => {
      const result = validateAndParseQuantity(5);

      expect(result.isValid).toBe(true);
      expect(result.quantity).toBe(5);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should validate string number', () => {
      const result = validateAndParseQuantity('3');

      expect(result.isValid).toBe(true);
      expect(result.quantity).toBe(3);
    });

    it('should reject non-number', () => {
      const result = validateAndParseQuantity('abc');

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('The item quantity has to be a valid number');
    });

    it('should reject decimal', () => {
      const result = validateAndParseQuantity(2.5);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('The item quantity has to be a valid integer greater than 0');
    });

    it('should reject zero', () => {
      const result = validateAndParseQuantity(0);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('The item quantity has to be a valid integer greater than 0');
    });

    it('should reject negative', () => {
      const result = validateAndParseQuantity(-1);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('The item quantity has to be a valid integer greater than 0');
    });
  });

});