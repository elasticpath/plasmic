import { renderHook, act } from '@testing-library/react';
import { useCheckout } from '../hooks/use-checkout';
import { CheckoutStep } from '../types';

// Mock fetch for integration tests
global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Checkout Integration Tests', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('Full Checkout Flow', () => {
    it('should complete full checkout flow successfully', async () => {
      const onComplete = jest.fn();
      const { result } = renderHook(() => 
        useCheckout({
          cartId: 'test-cart-123',
          onComplete
        })
      );

      // Step 1: Submit customer info
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

      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
      expect(result.current.state.customerData).toEqual(customerData.customer);

      // Step 2: Calculate and select shipping
      const mockShippingRates = [
        {
          id: 'standard',
          name: 'Standard Shipping',
          amount: 500,
          currency: 'USD',
          delivery_time: '3-5 days',
          service_level: 'standard'
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { shippingRates: mockShippingRates }
        })
      } as Response);

      let shippingRates: any;
      await act(async () => {
        shippingRates = await result.current.calculateShipping(customerData.billingAddress);
      });

      expect(shippingRates).toEqual(mockShippingRates);

      act(() => {
        result.current.selectShippingRate(mockShippingRates[0]);
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);
      expect(result.current.state.selectedShippingRate).toEqual(mockShippingRates[0]);

      // Step 3: Create order
      const mockOrder = {
        id: 'order-123',
        type: 'order',
        status: 'incomplete',
        payment: 'pending',
        total: { amount: 2500, currency: 'USD' },
        subtotal: { amount: 2000, currency: 'USD' },
        tax: { amount: 0, currency: 'USD' },
        customer: customerData.customer,
        billing_address: customerData.billingAddress,
        relationships: { items: { data: [] } },
        meta: {}
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { order: mockOrder }
        })
      } as Response);

      let order: any;
      await act(async () => {
        order = await result.current.createOrder();
      });

      expect(order).toEqual(mockOrder);
      expect(result.current.state.order).toEqual(mockOrder);

      // Step 4: Setup payment
      const mockPaymentSetup = {
        clientSecret: 'pi_test_123_secret',
        transactionId: 'tx-123'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockPaymentSetup
        })
      } as Response);

      let paymentSetup: any;
      await act(async () => {
        paymentSetup = await result.current.setupPayment('order-123', 2500, 'USD');
      });

      expect(paymentSetup).toEqual(mockPaymentSetup);
      expect(result.current.state.paymentSetup).toBeDefined();

      // Step 5: Confirm payment
      const confirmedOrder = {
        ...mockOrder,
        status: 'complete',
        payment: 'paid'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { order: confirmedOrder }
        })
      } as Response);

      let finalOrder: any;
      await act(async () => {
        finalOrder = await result.current.confirmPayment('order-123', 'tx-123', 'pi_test_123');
      });

      expect(finalOrder).toEqual(confirmedOrder);
      expect(result.current.state.currentStep).toBe(CheckoutStep.CONFIRMATION);
      expect(onComplete).toHaveBeenCalledWith(confirmedOrder);
    });

    it('should handle checkout errors gracefully', async () => {
      const onError = jest.fn();
      const { result } = renderHook(() => 
        useCheckout({
          cartId: 'invalid-cart',
          onError
        })
      );

      // Mock API error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          error: { message: 'Cart not found' }
        })
      } as Response);

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

      // Set state for order creation
      act(() => {
        result.current.state.customerData = customerData.customer;
        result.current.state.billingAddress = customerData.billingAddress;
      });

      await expect(
        act(async () => {
          await result.current.createOrder();
        })
      ).rejects.toThrow('Cart not found');

      expect(result.current.state.error).toBeDefined();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('Step Navigation', () => {
    it('should enforce proper step progression', () => {
      const { result } = renderHook(() => useCheckout());

      // Cannot proceed without customer data
      expect(result.current.canProceedToNext).toBe(false);

      // Add customer data
      act(() => {
        result.current.state.customerData = {
          name: 'John Doe',
          email: 'john@example.com'
        };
        result.current.state.billingAddress = {
          first_name: 'John',
          last_name: 'Doe',
          line_1: '123 Main St',
          city: 'New York',
          country: 'US',
          postcode: '10001'
        };
      });

      expect(result.current.canProceedToNext).toBe(true);

      // Move to shipping step
      act(() => {
        result.current.nextStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);
      expect(result.current.canProceedToNext).toBe(false);

      // Select shipping
      act(() => {
        result.current.state.selectedShippingRate = {
          id: 'standard',
          name: 'Standard',
          amount: 500,
          currency: 'USD',
          delivery_time: '3-5 days',
          service_level: 'standard'
        };
      });

      expect(result.current.canProceedToNext).toBe(true);

      // Move to payment step
      act(() => {
        result.current.nextStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);
    });

    it('should allow navigation back to previous steps', () => {
      const { result } = renderHook(() => useCheckout());

      // Move to payment step
      act(() => {
        result.current.goToStep(CheckoutStep.PAYMENT);
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.PAYMENT);

      // Go back to shipping
      act(() => {
        result.current.previousStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.SHIPPING);

      // Go back to customer info
      act(() => {
        result.current.previousStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);

      // Cannot go before first step
      act(() => {
        result.current.previousStep();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
    });
  });

  describe('Total Calculation', () => {
    it('should calculate total correctly with shipping', () => {
      const { result } = renderHook(() => useCheckout());

      act(() => {
        result.current.state.order = {
          id: 'order-123',
          total: { amount: 2000, currency: 'USD' }
        } as any;

        result.current.state.selectedShippingRate = {
          id: 'express',
          name: 'Express',
          amount: 1000,
          currency: 'USD',
          delivery_time: '1-2 days',
          service_level: 'express'
        };
      });

      expect(result.current.totalAmount).toBe(3000);
    });

    it('should handle missing order or shipping gracefully', () => {
      const { result } = renderHook(() => useCheckout());

      expect(result.current.totalAmount).toBe(0);

      act(() => {
        result.current.state.order = {
          id: 'order-123',
          total: { amount: 2000, currency: 'USD' }
        } as any;
      });

      expect(result.current.totalAmount).toBe(2000);
    });
  });

  describe('Error Recovery', () => {
    it('should allow retry after errors', async () => {
      const { result } = renderHook(() => 
        useCheckout({ cartId: 'test-cart-123' })
      );

      // First request fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: { message: 'Server error' }
        })
      } as Response);

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

      act(() => {
        result.current.state.customerData = customerData.customer;
        result.current.state.billingAddress = customerData.billingAddress;
      });

      // First attempt fails
      await expect(
        act(async () => {
          await result.current.createOrder();
        })
      ).rejects.toThrow('Server error');

      // Second request succeeds
      const mockOrder = {
        id: 'order-123',
        total: { amount: 2000, currency: 'USD' },
        relationships: { items: { data: [] } }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { order: mockOrder }
        })
      } as Response);

      let order: any;
      await act(async () => {
        order = await result.current.createOrder();
      });

      expect(order).toEqual(mockOrder);
      expect(result.current.state.error).toBeUndefined();
    });
  });

  describe('State Reset', () => {
    it('should reset all state when requested', () => {
      const { result } = renderHook(() => useCheckout());

      // Set up some state
      act(() => {
        result.current.state.currentStep = CheckoutStep.PAYMENT;
        result.current.state.customerData = {
          name: 'John Doe',
          email: 'john@example.com'
        };
        result.current.state.order = {
          id: 'order-123'
        } as any;
      });

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.state.currentStep).toBe(CheckoutStep.CUSTOMER_INFO);
      expect(result.current.state.customerData).toBeUndefined();
      expect(result.current.state.order).toBeUndefined();
      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.canProceedToNext).toBe(false);
    });
  });
});