import {
  resolveLocationSlug,
  extractCartItemFromForm,
  buildCartItemData,
  validateCartItem,
  validateAndParseQuantity,
  getCartItemId,
  createCartDebugInfo,
} from '../cartDataBuilder';
import type { BundleConfiguration } from '@epcc-sdk/sdks-shopper';

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
    it('should extract complete cart item', () => {
      const formValues = {
        ProductQuantity: 3,
        ProductVariant: 'variant-2',
        BundleConfiguration: mockBundleConfig,
        SelectedLocationSlug: 'location-1',
      };
      const props = {};

      const result = extractCartItemFromForm(formValues, mockProduct, props);

      expect(result.productId).toBe('prod-123');
      expect(result.variantId).toBe('variant-2');
      expect(result.quantity).toBe(3);
      expect(result.bundleConfiguration).toEqual(mockBundleConfig);
      expect(result.locationId).toBe('location-1');
    });

    it('should use defaults when form values missing', () => {
      const formValues = {};
      const props = { locationSlug: 'prop-location' };

      const result = extractCartItemFromForm(formValues, mockProduct, props);

      expect(result.productId).toBe('prod-123');
      expect(result.variantId).toBe('variant-1'); // first variant
      expect(result.quantity).toBe(1); // default quantity
      expect(result.bundleConfiguration).toBeUndefined();
      expect(result.locationId).toBe('prop-location');
    });

    it('should handle product without variants', () => {
      const productNoVariants = { id: 'prod-simple' };
      const formValues = {};
      const props = {};

      const result = extractCartItemFromForm(formValues, productNoVariants, props);

      // For core compatibility, variantId should fallback to productId when no variants exist
      expect(result.variantId).toBe('prod-simple');
      expect(result.productId).toBe('prod-simple');
    });
  });

  describe('buildCartItemData', () => {
    it('should build complete cart item data', () => {
      const item = {
        productId: 'prod-123',
        variantId: 'variant-1',
        quantity: 2,
        bundleConfiguration: mockBundleConfig,
        locationId: 'location-1',
      };

      const result = buildCartItemData(item);

      expect(result.type).toBe('cart_item');
      expect(result.id).toBe('variant-1');
      expect(result.quantity).toBe(2);
      expect(result.bundle_configuration).toEqual(mockBundleConfig);
      expect(result.location).toBe('location-1');
    });

    it('should use product ID when no variant', () => {
      const item = {
        variantId: 'prod-123', // Use productId as variantId when no variant
        productId: 'prod-123',
        quantity: 1,
      };

      const result = buildCartItemData(item);

      expect(result.id).toBe('prod-123');
      expect(result.quantity).toBe(1);
      expect(result.bundle_configuration).toBeUndefined();
      expect(result.location).toBeUndefined();
    });

    it('should use default quantity', () => {
      const item = { 
        variantId: 'var-123',
        productId: 'prod-123' 
      };

      const result = buildCartItemData(item);

      expect(result.quantity).toBe(1);
    });
  });

  describe('validateCartItem', () => {
    it('should validate valid cart item', () => {
      const item = {
        variantId: 'var-123',
        productId: 'prod-123',
        quantity: 2,
      };

      const result = validateCartItem(item);

      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should reject item without variant ID', () => {
      const item = {
        variantId: '',
        productId: 'prod-123',
        quantity: 1,
      };

      const result = validateCartItem(item);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Variant ID is required and must be a non-empty string');
    });

    it('should reject item without product ID', () => {
      const item = {
        variantId: 'var-123',
        productId: '',
        quantity: 1,
      };

      const result = validateCartItem(item);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Product ID is required for Elastic Path items');
    });

    it('should reject item with invalid quantity', () => {
      const item = {
        variantId: 'var-123',
        productId: 'prod-123',
        quantity: 0,
      };

      const result = validateCartItem(item);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be at least 1');
    });

    it('should reject item with non-integer quantity', () => {
      const item = {
        variantId: 'var-123',
        productId: 'prod-123',
        quantity: 2.5,
      };

      const result = validateCartItem(item);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be a whole number');
    });

    it('should handle missing quantity', () => {
      const item = {
        variantId: 'var-123',
        productId: 'prod-123',
      };

      const result = validateCartItem(item);

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe('Quantity must be at least 1');
    });
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

  describe('getCartItemId', () => {
    it('should return variant ID when provided', () => {
      const result = getCartItemId('prod-123', 'variant-1');
      expect(result).toBe('variant-1');
    });

    it('should return product ID when no variant', () => {
      const result = getCartItemId('prod-123');
      expect(result).toBe('prod-123');
    });

    it('should return product ID when variant is empty', () => {
      const result = getCartItemId('prod-123', '');
      expect(result).toBe('prod-123');
    });
  });

  describe('createCartDebugInfo', () => {
    it('should create comprehensive debug info', () => {
      const item = {
        productId: 'prod-123',
        variantId: 'variant-1',
        quantity: 2,
        bundleConfiguration: mockBundleConfig,
        locationId: 'location-1',
      };

      const cartData = buildCartItemData(item);
      const result = createCartDebugInfo(item, cartData);

      expect(result.originalItem).toEqual(item);
      expect(result.builtCartData).toEqual(cartData);
      expect(result.hasBundle).toBe(true);
      expect(result.hasLocation).toBe(true);
      expect(result.cartItemId).toBe('variant-1');
      expect(result.timestamp).toBeDefined();
    });

    it('should handle item without bundle or location', () => {
      const item = {
        variantId: 'var-123',
        productId: 'prod-123',
        quantity: 1,
      };

      const cartData = buildCartItemData(item);
      const result = createCartDebugInfo(item, cartData);

      expect(result.hasBundle).toBe(false);
      expect(result.hasLocation).toBe(false);
      expect(result.cartItemId).toBe('var-123');
    });
  });
});