import { normalizeProduct } from '../utils/normalize';
import { ProductData, ProductListData } from '@epcc-sdk/sdks-shopper';

describe('normalize utilities', () => {
  describe('normalizeProduct', () => {
    const mockProductData: ProductData = {
      data: {
        id: 'parent-123',
        type: 'product',
        attributes: {
          name: 'Test Product',
          slug: 'test-product',
          description: 'A test product',
          sku: 'TEST-SKU',
        },
        meta: {
          display_price: {
            without_tax: {
              amount: 10000,
              currency: 'USD',
            },
          },
          variations: [
            {
              id: 'size-variation',
              name: 'Size',
              options: [
                { id: 'size-small', name: 'Small' },
                { id: 'size-medium', name: 'Medium' },
                { id: 'size-large', name: 'Large' },
              ],
            },
            {
              id: 'color-variation',
              name: 'Color',
              options: [
                { id: 'color-red', name: 'Red' },
                { id: 'color-blue', name: 'Blue' },
              ],
            },
          ],
          variation_matrix: {
            'size-small': {
              'color-red': 'child-1',
              'color-blue': 'child-2',
            },
            'size-medium': {
              'color-red': 'child-3',
              'color-blue': 'child-4',
            },
            'size-large': {
              'color-red': 'child-5',
              'color-blue': 'child-6',
            },
          },
        },
      },
    };

    const mockChildProducts: ProductListData = {
      data: [
        {
          id: 'child-1',
          type: 'product',
          attributes: {
            name: 'Test Product - Small Red',
            slug: 'test-product-small-red',
            status: 'live',
          },
          meta: {
            display_price: {
              without_tax: {
                amount: 11000,
                currency: 'USD',
              },
            },
          },
        },
        {
          id: 'child-2',
          type: 'product',
          attributes: {
            name: 'Test Product - Small Blue',
            slug: 'test-product-small-blue',
            status: 'live',
          },
          meta: {
            display_price: {
              without_tax: {
                amount: 11500,
                currency: 'USD',
              },
            },
          },
        },
        {
          id: 'child-3',
          type: 'product',
          attributes: {
            name: 'Test Product - Medium Red',
            slug: 'test-product-medium-red',
            status: 'live',
          },
          meta: {
            display_price: {
              without_tax: {
                amount: 12000,
                currency: 'USD',
              },
            },
          },
        },
      ],
    };

    it('should normalize a simple product without variations', () => {
      const simpleProduct: ProductData = {
        data: {
          id: 'simple-123',
          type: 'product',
          attributes: {
            name: 'Simple Product',
            slug: 'simple-product',
            description: 'A simple product',
            status: 'live',
          },
          meta: {
            display_price: {
              without_tax: {
                amount: 5000,
                currency: 'USD',
              },
            },
          },
        },
      };

      const result = normalizeProduct(simpleProduct, 'en-US');

      expect(result.id).toBe('simple-123');
      expect(result.name).toBe('Simple Product');
      expect(result.slug).toBe('simple-product');
      expect(result.price.value).toBe(50); // 5000 cents = $50
      expect(result.price.currencyCode).toBe('USD');
      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].availableForSale).toBe(false); // Parent products never available for sale
      expect(result.options).toHaveLength(0);
    });

    it('should normalize parent product variations as options', () => {
      const result = normalizeProduct(mockProductData, 'en-US');

      expect(result.options).toHaveLength(2);
      expect(result.options[0].displayName).toBe('Size');
      expect(result.options[0].values).toHaveLength(3);
      expect(result.options[1].displayName).toBe('Color');
      expect(result.options[1].values).toHaveLength(2);
    });

    it('should normalize child products as variants with correct options', () => {
      const result = normalizeProduct(mockProductData, 'en-US', mockChildProducts);

      expect(result.variants).toHaveLength(3);

      // Check first variant (Small Red)
      const variant1 = result.variants.find(v => v.id === 'child-1');
      expect(variant1).toBeDefined();
      expect(variant1?.name).toBe('Test Product - Small Red');
      expect(variant1?.price).toBe(110); // 11000 cents = $110
      expect(variant1?.options).toHaveLength(2);
      expect(variant1?.options[0].displayName).toBe('Size');
      expect(variant1?.options[0].values[0].label).toBe('Small');
      expect(variant1?.options[1].displayName).toBe('Color');
      expect(variant1?.options[1].values[0].label).toBe('Red');

      // Check second variant (Small Blue)
      const variant2 = result.variants.find(v => v.id === 'child-2');
      expect(variant2).toBeDefined();
      expect(variant2?.price).toBe(115); // 11500 cents = $115
      expect(variant2?.options[0].values[0].label).toBe('Small');
      expect(variant2?.options[1].values[0].label).toBe('Blue');

      // Check third variant (Medium Red)
      const variant3 = result.variants.find(v => v.id === 'child-3');
      expect(variant3).toBeDefined();
      expect(variant3?.price).toBe(120); // 12000 cents = $120
      expect(variant3?.options[0].values[0].label).toBe('Medium');
      expect(variant3?.options[1].values[0].label).toBe('Red');
    });

    it('should handle missing variation_matrix gracefully', () => {
      const productWithoutMatrix: ProductData = {
        data: {
          ...mockProductData.data,
          meta: {
            ...mockProductData.data!.meta,
            variation_matrix: undefined,
          },
        },
      };

      const result = normalizeProduct(productWithoutMatrix, 'en-US', mockChildProducts);

      // Should still create variants but without options
      expect(result.variants).toHaveLength(3);
      result.variants.forEach(variant => {
        expect(variant.options).toHaveLength(0);
      });
    });

    it('should handle child product without ID', () => {
      const childWithoutId: ProductListData = {
        data: [
          {
            type: 'product',
            attributes: {
              name: 'No ID Product',
            },
            meta: {
              display_price: {
                without_tax: {
                  amount: 1000,
                  currency: 'USD',
                },
              },
            },
          },
        ],
      };

      const result = normalizeProduct(mockProductData, 'en-US', childWithoutId);

      // Should create a variant with empty ID
      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].id).toBe('');
      expect(result.variants[0].options).toHaveLength(0);
    });

    it('should set availableForSale based on status and price', () => {
      const childProductsWithVariousStates: ProductListData = {
        data: [
          {
            id: 'live-with-price',
            type: 'product',
            attributes: {
              name: 'Available Product',
              status: 'live',
            },
            meta: {
              display_price: {
                without_tax: {
                  amount: 10000,
                  currency: 'USD',
                },
              },
            },
          },
          {
            id: 'live-no-price',
            type: 'product',
            attributes: {
              name: 'No Price Product',
              status: 'live',
            },
            meta: {
              display_price: {
                without_tax: {
                  amount: 0,
                  currency: 'USD',
                },
              },
            },
          },
          {
            id: 'draft-with-price',
            type: 'product',
            attributes: {
              name: 'Draft Product',
              status: 'draft',
            },
            meta: {
              display_price: {
                without_tax: {
                  amount: 5000,
                  currency: 'USD',
                },
              },
            },
          },
        ],
      };

      const result = normalizeProduct(mockProductData, 'en-US', childProductsWithVariousStates);

      expect(result.variants).toHaveLength(3);
      
      // Live with price should be available
      const availableVariant = result.variants.find(v => v.id === 'live-with-price');
      expect(availableVariant?.availableForSale).toBe(true);
      
      // Live with no price should not be available
      const noPriceVariant = result.variants.find(v => v.id === 'live-no-price');
      expect(noPriceVariant?.availableForSale).toBe(false);
      
      // Draft with price should not be available
      const draftVariant = result.variants.find(v => v.id === 'draft-with-price');
      expect(draftVariant?.availableForSale).toBe(false);
    });
  });
});