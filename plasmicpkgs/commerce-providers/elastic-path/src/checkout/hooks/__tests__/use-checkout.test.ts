import { renderHook, act } from '@testing-library/react';
import { useCheckout } from '../use-checkout';
import { CheckoutStep } from '../../types';

// Mock fetch
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('useCheckout Hook', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() => useCheckout());

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.customerData).toBeUndefined();
      expect(result.current.state.billingAddress).toBeUndefined();
      expect(result.current.canProceedToNext).toBe(false);
    });

    it('should accept configuration options', () => {
      const onComplete = jest.fn();
      const onError = jest.fn();

      const { result } = renderHook(() => 
        useCheckout({
          cartId: 'test-cart-123',
          apiBaseUrl: '/custom-api',
          autoAdvanceSteps: false,
          onComplete,
          onError
        })
      );

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
    });
  });

  describe('Customer Info Submission', () => {
    it('should submit customer info successfully', async () => {
      const { result } = renderHook(() => useCheckout());

      const formData = {
        customer: {
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
        },
        sameAsBilling: true
      };

      await act(async () => {
        await result.current.submitCustomerInfo(formData);
      });

      expect(result.current.state.customerData).toEqual(formData.customer);
      expect(result.current.state.billingAddress).toEqual(formData.billingAddress);
      expect(result.current.state.shippingAddress).toEqual(formData.billingAddress);
      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
    });

    it('should handle separate shipping address', async () => {
      const { result } = renderHook(() => useCheckout());

      const formData = {
        customer: {
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
        },
        shippingAddress: {
          first_name: 'Jane',
          last_name: 'Smith',
          line_1: '456 Oak Ave',
          city: 'Boston',
          country: 'US',
          postcode: '02101'
        },
        sameAsBilling: false
      };

      await act(async () => {
        await result.current.submitCustomerInfo(formData);
      });

      expect(result.current.state.shippingAddress).toEqual(formData.shippingAddress);
      expect(result.current.state.shippingAddress).not.toEqual(formData.billingAddress);
    });

    it('should not auto-advance when disabled', async () => {
      const { result } = renderHook(() => 
        useCheckout({ autoAdvanceSteps: false })
      );

      const formData = {
        customer: { name: 'John Doe', email: 'john@example.com' },
        billingAddress: {
          first_name: 'John',
          last_name: 'Doe',
          line_1: '123 Main St',
          city: 'New York',
          country: 'US',
          postcode: '10001'
        },
        sameAsBilling: true
      };

      await act(async () => {
        await result.current.submitCustomerInfo(formData);
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
    });
  });

  describe('Shipping Calculation', () => {
    it('should calculate shipping rates', async () => {
      const mockShippingRates = [
        {
          id: 'standard',
          name: 'Standard Shipping',
          amount: 500,
          currency: 'USD',
          delivery_time: '3-5 days'
        },
        {
          id: 'express',
          name: 'Express Shipping',
          amount: 1000,
          currency: 'USD',
          delivery_time: '1-2 days'
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { shippingRates: mockShippingRates }
        })
      } as Response);

      const { result } = renderHook(() => 
        useCheckout({ cartId: 'test-cart-123' })
      );

      const address = {
        first_name: 'John',
        last_name: 'Doe',
        line_1: '123 Main St',
        city: 'New York',
        country: 'US',
        postcode: '10001'
      };

      let rates: any;
      await act(async () => {
        rates = await result.current.calculateShipping(address);
      });

      expect(rates).toEqual(mockShippingRates);
      expect(mockFetch).toHaveBeenCalledWith('/api/checkout/calculate-shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cartId: 'test-cart-123',
          shippingAddress: address
        })
      });
    });

    it('should handle shipping calculation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: { message: 'Invalid address' }
        })
      } as Response);

      const { result } = renderHook(() => 
        useCheckout({ cartId: 'test-cart-123' })
      );

      const address = {
        first_name: 'John',
        last_name: 'Doe',
        line_1: '123 Main St',
        city: 'New York',
        country: 'US',
        postcode: '10001'
      };

      await expect(
        act(async () => {
          await result.current.calculateShipping(address);
        })
      ).rejects.toThrow('Invalid address');
    });

    it('should require cart ID for shipping calculation', async () => {
      const { result } = renderHook(() => useCheckout());

      const address = {
        first_name: 'John',
        last_name: 'Doe',
        line_1: '123 Main St',
        city: 'New York',
        country: 'US',
        postcode: '10001'
      };

      await expect(
        act(async () => {
          await result.current.calculateShipping(address);
        })
      ).rejects.toThrow('Cart ID is required');
    });
  });

  describe('Shipping Rate Selection', () => {
    it('should select shipping rate and advance step', () => {
      const { result } = renderHook(() => useCheckout());

      const shippingRate = {
        id: 'standard',
        name: 'Standard Shipping',
        amount: 500,
        currency: 'USD',
        delivery_time: '3-5 days',
        service_level: 'standard'
      };

      act(() => {
        result.current.selectShippingRate(shippingRate);
      });

      expect(result.current.state.selectedShippingRate).toEqual(shippingRate);
      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);
    });
  });

  describe('Order Creation', () => {
    it('should create order successfully', async () => {
      const mockOrder = {
        id: 'order-123',
        type: 'order',
        status: 'incomplete',
        total: { amount: 2000, currency: 'USD' },
        subtotal: { amount: 1800, currency: 'USD' },
        tax: { amount: 200, currency: 'USD' },
        relationships: { items: { data: [] } }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { order: mockOrder }
        })
      } as Response);

      const { result } = renderHook(() => 
        useCheckout({ cartId: 'test-cart-123' })
      );

      // Set up required state first
      const customerData = {
        customer: {
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
        },
        sameAsBilling: true
      };

      await act(async () => {
        await result.current.submitCustomerInfo(customerData);
      });

      let order: any;
      await act(async () => {
        order = await result.current.createOrder();
      });

      expect(order).toEqual(mockOrder);
      expect(result.current.state.order).toEqual(mockOrder);
    });

    it('should require customer data and billing address', async () => {
      const { result } = renderHook(() => 
        useCheckout({ cartId: 'test-cart-123' })
      );

      await expect(
        act(async () => {
          await result.current.createOrder();
        })
      ).rejects.toThrow('Missing required checkout data');
    });
  });

  describe('Navigation', () => {
    it('should navigate to specific step', () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.goToStep(CheckoutStep.PAYMENT);
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);
    });

    it('should navigate to next step', () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
    });

    it('should navigate to previous step', () => {
      const { result } = renderHook(() => useCheckout());

      // First go to shipping step
      act(() => {
        result.current.goToStep(CheckoutStep.SHIPPING);
      });

      // Then go back
      act(() => {
        result.current.previousStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
    });

    it('should not go beyond first step when going previous', () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.previousStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
    });

    it('should not go beyond last step when going next', () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.goToStep(CheckoutStep.CONFIRMATION);
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CONFIRMATION);

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CONFIRMATION);
    });
  });

  describe('Can Proceed Logic', () => {
    it('should determine if can proceed from customer info step', async () => {
      const { result } = renderHook(() => useCheckout({ autoAdvanceSteps: false }));

      expect(result.current.canProceedToNext).toBe(false);

      // Submit complete customer info to properly set state
      const formData = {
        customer: {
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
        },
        sameAsBilling: true
      };

      await act(async () => {
        await result.current.submitCustomerInfo(formData);
      });

      // Should still be on customer info step since autoAdvanceSteps is false
      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
      expect(result.current.canProceedToNext).toBe(true);
    });

    it('should determine if can proceed from shipping step', () => {
      const { result } = renderHook(() => useCheckout({ autoAdvanceSteps: false }));

      act(() => {
        result.current.goToStep(CheckoutStep.SHIPPING);
      });

      expect(result.current.canProceedToNext).toBe(false);

      const shippingRate = {
        id: 'standard',
        name: 'Standard',
        amount: 500,
        currency: 'USD',
        delivery_time: '3-5 days',
        service_level: 'standard'
      };

      act(() => {
        result.current.selectShippingRate(shippingRate);
      });

      // Should still be on shipping step since autoAdvanceSteps is false
      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
      expect(result.current.canProceedToNext).toBe(true);
    });
  });

  describe('Total Amount Calculation', () => {
    it('should calculate total with shipping', async () => {
      const mockOrder = {
        id: 'order-123',
        type: 'order',
        status: 'incomplete',
        payment: 'pending',
        total: { amount: 2000, currency: 'USD' },
        subtotal: { amount: 2000, currency: 'USD' },
        tax: { amount: 0, currency: 'USD' },
        relationships: { items: { data: [] } }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { order: mockOrder }
        })
      } as Response);

      const { result } = renderHook(() => 
        useCheckout({ cartId: 'test-cart-123' })
      );

      // Set up required state first, then create order
      const customerData = {
        customer: { name: 'John Doe', email: 'john@example.com' },
        billingAddress: {
          first_name: 'John',
          last_name: 'Doe',
          line_1: '123 Main St',
          city: 'New York',
          country: 'US',
          postcode: '10001'
        },
        sameAsBilling: true
      };

      await act(async () => {
        await result.current.submitCustomerInfo(customerData);
      });

      await act(async () => {
        await result.current.createOrder();
      });

      const shippingRate = {
        id: 'standard',
        name: 'Standard',
        amount: 500,
        currency: 'USD',
        delivery_time: '3-5 days',
        service_level: 'standard'
      };

      act(() => {
        result.current.selectShippingRate(shippingRate);
      });

      expect(result.current.totalAmount).toBe(2500);
    });

    it('should return order total when no shipping selected', async () => {
      const mockOrder = {
        id: 'order-123',
        type: 'order',
        status: 'incomplete',
        payment: 'pending',
        total: { amount: 2000, currency: 'USD' },
        subtotal: { amount: 2000, currency: 'USD' },
        tax: { amount: 0, currency: 'USD' },
        relationships: { items: { data: [] } }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { order: mockOrder }
        })
      } as Response);

      const { result } = renderHook(() => 
        useCheckout({ cartId: 'test-cart-123' })
      );

      // Set up required state first, then create order
      const customerData = {
        customer: { name: 'John Doe', email: 'john@example.com' },
        billingAddress: {
          first_name: 'John',
          last_name: 'Doe',
          line_1: '123 Main St',
          city: 'New York',
          country: 'US',
          postcode: '10001'
        },
        sameAsBilling: true
      };

      await act(async () => {
        await result.current.submitCustomerInfo(customerData);
      });

      await act(async () => {
        await result.current.createOrder();
      });

      expect(result.current.totalAmount).toBe(2000);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset to initial state', async () => {
      const { result } = renderHook(() => useCheckout());

      // Set some state using proper methods
      const formData = {
        customer: {
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
        },
        sameAsBilling: true
      };

      await act(async () => {
        await result.current.submitCustomerInfo(formData);
        result.current.goToStep(CheckoutStep.PAYMENT);
      });

      // Verify state was set
      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);
      expect(result.current.state.customerData).toBeDefined();

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
      expect(result.current.state.customerData).toBeUndefined();
      expect(result.current.state.isLoading).toBe(false);
    });
  });
});