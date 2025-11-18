import { jest } from '@jest/globals';
import setupPaymentHandler from '../setup-payment';
import { paymentSetup } from '@epcc-sdk/sdks-shopper';
import Stripe from 'stripe';

// Mock the dependencies
jest.mock('@epcc-sdk/sdks-shopper');
jest.mock('stripe');

const mockPaymentSetup = paymentSetup as jest.MockedFunction<typeof paymentSetup>;
const MockedStripe = Stripe as jest.MockedClass<typeof Stripe>;

describe('Setup Payment API Endpoint', () => {
  let req: any;
  let res: any;
  let mockStripeInstance: any;

  beforeEach(() => {
    process.env = {
      EP_CLIENT_ID: 'test-client-id',
      EP_HOST: 'https://api.moltin.com',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
    };

    req = {
      method: 'POST',
      body: {
        orderId: 'order-123',
        amount: 2000,
        currency: 'USD',
        gateway: 'stripe'
      }
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    // Mock Stripe instance
    mockStripeInstance = {
      paymentIntents: {
        create: jest.fn(),
        cancel: jest.fn()
      }
    };

    MockedStripe.mockImplementation(() => mockStripeInstance);

    jest.clearAllMocks();
  });

  describe('Success Cases', () => {
    it('should setup payment successfully', async () => {
      const mockPaymentIntent = {
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret',
        amount: 2000,
        currency: 'usd'
      };

      const mockEPResponse = {
        data: {
          data: {
            id: 'tx-123',
            type: 'transaction'
          }
        }
      };

      mockStripeInstance.paymentIntents.create.mockResolvedValue(mockPaymentIntent);
      mockPaymentSetup.mockResolvedValue(mockEPResponse);

      await setupPaymentHandler(req, res);

      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith({
        amount: 2000,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          order_id: 'order-123',
          source: 'elastic-path-checkout'
        }
      });

      expect(mockPaymentSetup).toHaveBeenCalledWith({
        client: expect.any(Object),
        path: { orderID: 'order-123' },
        body: {
          data: {
            gateway: 'stripe',
            method: 'card',
            amount: 2000,
            currency: 'usd',
            payment_intent_id: 'pi_test_123',
            client_secret: 'pi_test_123_secret'
          }
        }
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          clientSecret: 'pi_test_123_secret',
          transactionId: 'tx-123',
          paymentIntentId: 'pi_test_123'
        }
      });
    });

    it('should handle different currencies', async () => {
      req.body.currency = 'EUR';

      const mockPaymentIntent = {
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret',
        amount: 2000,
        currency: 'eur'
      };

      mockStripeInstance.paymentIntents.create.mockResolvedValue(mockPaymentIntent);
      mockPaymentSetup.mockResolvedValue({
        data: { data: { id: 'tx-123' } }
      });

      await setupPaymentHandler(req, res);

      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'eur'
        })
      );
    });
  });

  describe('Validation Errors', () => {
    it('should reject invalid HTTP method', async () => {
      req.method = 'GET';

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
    });

    it('should reject missing order ID', async () => {
      delete req.body.orderId;

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid amount', async () => {
      req.body.amount = -100;

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject amount below minimum', async () => {
      req.body.amount = 0.25; // Below $0.50 minimum

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining('$0.50')
        })
      });
    });

    it('should reject invalid currency', async () => {
      req.body.currency = 'INVALID';

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject unsupported gateway', async () => {
      req.body.gateway = 'paypal';

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          message: expect.stringContaining('paypal')
        })
      });
    });
  });

  describe('Stripe Errors', () => {
    it('should handle Stripe payment intent creation failure', async () => {
      mockStripeInstance.paymentIntents.create.mockRejectedValue({
        type: 'StripeCardError',
        message: 'Your card was declined.'
      });

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should handle missing client secret', async () => {
      mockStripeInstance.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        client_secret: null
      });

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Elastic Path Errors', () => {
    it('should cancel Stripe payment intent if EP setup fails', async () => {
      const mockPaymentIntent = {
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret'
      };

      mockStripeInstance.paymentIntents.create.mockResolvedValue(mockPaymentIntent);
      mockPaymentSetup.mockResolvedValue({ data: null });

      await setupPaymentHandler(req, res);

      expect(mockStripeInstance.paymentIntents.cancel).toHaveBeenCalledWith('pi_test_123');
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should handle EP API errors', async () => {
      const mockPaymentIntent = {
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret'
      };

      mockStripeInstance.paymentIntents.create.mockResolvedValue(mockPaymentIntent);
      mockPaymentSetup.mockRejectedValue({
        response: {
          status: 404,
          data: { errors: [{ detail: 'Order not found' }] }
        }
      });

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('Environment Validation', () => {
    it('should reject missing Stripe secret key', async () => {
      delete process.env.STRIPE_SECRET_KEY;

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should reject missing EP client ID', async () => {
      delete process.env.EP_CLIENT_ID;

      await setupPaymentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Currency Support', () => {
    it('should support major currencies', async () => {
      const supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];

      for (const currency of supportedCurrencies) {
        req.body.currency = currency;

        mockStripeInstance.paymentIntents.create.mockResolvedValue({
          id: 'pi_test_123',
          client_secret: 'pi_test_123_secret',
          currency: currency.toLowerCase()
        });

        mockPaymentSetup.mockResolvedValue({
          data: { data: { id: 'tx-123' } }
        });

        await setupPaymentHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        jest.clearAllMocks();
      }
    });
  });

  describe('Amount Conversion', () => {
    it('should convert dollars to cents correctly', async () => {
      req.body.amount = 19.99;

      mockStripeInstance.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret'
      });

      mockPaymentSetup.mockResolvedValue({
        data: { data: { id: 'tx-123' } }
      });

      await setupPaymentHandler(req, res);

      expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1999 // 19.99 * 100
        })
      );
    });
  });
});