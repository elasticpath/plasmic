import { jest } from '@jest/globals';
import createOrderHandler from '../create-order';
import { createCheckout } from '@epcc-sdk/sdks-shopper';

// Mock the Elastic Path SDK
jest.mock('@epcc-sdk/sdks-shopper');
const mockCreateCheckout = createCheckout as jest.MockedFunction<typeof createCheckout>;

// Mock environment variables
const originalEnv = process.env;

describe('Create Order API Endpoint', () => {
  let req: any;
  let res: any;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EP_CLIENT_ID: 'test-client-id',
      EP_HOST: 'https://api.moltin.com'
    };

    req = {
      method: 'POST',
      body: {
        cartId: 'test-cart-123',
        customerData: {
          name: 'John Doe',
          email: 'john@example.com'
        },
        billingAddress: {
          first_name: 'John',
          last_name: 'Doe',
          line_1: '123 Main St',
          city: 'New York',
          country: 'US',
          postcode: '10001'
        }
      }
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Success Cases', () => {
    it('should create order successfully with valid data', async () => {
      const mockOrderResponse = {
        data: {
          data: {
            id: 'order-123',
            type: 'order',
            status: 'incomplete',
            meta: {
              display_price: {
                with_tax: { amount: 2000, currency: 'USD' },
                without_tax: { amount: 1800, currency: 'USD' },
                tax: { amount: 200, currency: 'USD' }
              }
            },
            billing_address: req.body.billingAddress,
            customer: req.body.customerData,
            relationships: { items: { data: [] } }
          }
        }
      };

      mockCreateCheckout.mockResolvedValue(mockOrderResponse);

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          order: expect.objectContaining({
            id: 'order-123',
            type: 'order',
            status: 'incomplete'
          })
        }
      });
    });

    it('should handle shipping address different from billing', async () => {
      req.body.shippingAddress = {
        first_name: 'Jane',
        last_name: 'Smith',
        line_1: '456 Oak Ave',
        city: 'Boston',
        country: 'US',
        postcode: '02101'
      };

      const mockOrderResponse = {
        data: {
          data: {
            id: 'order-123',
            type: 'order',
            status: 'incomplete',
            meta: { display_price: { with_tax: { amount: 2000, currency: 'USD' } } },
            billing_address: req.body.billingAddress,
            shipping_address: req.body.shippingAddress,
            relationships: { items: { data: [] } }
          }
        }
      };

      mockCreateCheckout.mockResolvedValue(mockOrderResponse);

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockCreateCheckout).toHaveBeenCalledWith({
        client: expect.any(Object),
        path: { cartID: 'test-cart-123' },
        body: {
          data: expect.objectContaining({
            shipping_address: req.body.shippingAddress
          })
        }
      });
    });
  });

  describe('Validation Errors', () => {
    it('should reject invalid HTTP method', async () => {
      req.method = 'GET';

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { message: 'Method not allowed' }
      });
    });

    it('should reject missing cart ID', async () => {
      delete req.body.cartId;

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining('cartId')
        })
      });
    });

    it('should reject missing customer data', async () => {
      delete req.body.customerData;

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid email format', async () => {
      req.body.customerData.email = 'invalid-email';

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing billing address', async () => {
      delete req.body.billingAddress;

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Elastic Path Errors', () => {
    it('should handle EP API errors', async () => {
      mockCreateCheckout.mockRejectedValue({
        response: {
          status: 404,
          data: { errors: [{ detail: 'Cart not found' }] }
        }
      });

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining('Cart not found')
        })
      });
    });

    it('should handle EP connection errors', async () => {
      mockCreateCheckout.mockRejectedValue(new Error('Network error'));

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should handle empty response from EP', async () => {
      mockCreateCheckout.mockResolvedValue({ data: null });

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining('Failed to create order')
        })
      });
    });
  });

  describe('Environment Validation', () => {
    it('should reject missing EP_CLIENT_ID', async () => {
      delete process.env.EP_CLIENT_ID;

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining('EP_CLIENT_ID')
        })
      });
    });
  });

  describe('Address Validation', () => {
    it('should validate billing address fields', async () => {
      req.body.billingAddress = {
        first_name: '',
        last_name: 'Doe',
        line_1: '123 Main St',
        city: 'New York',
        country: 'US',
        postcode: '10001'
      };

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should validate postal code format', async () => {
      req.body.billingAddress.postcode = 'invalid';

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should validate country code', async () => {
      req.body.billingAddress.country = 'XX';

      await createOrderHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});