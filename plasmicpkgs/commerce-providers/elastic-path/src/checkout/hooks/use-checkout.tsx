import { useState, useCallback } from 'react';
import { CheckoutStep } from '../types';
import type { 
  CheckoutFormData, 
  CheckoutState, 
  ElasticPathOrder,
  CustomerData,
  AddressData,
  ShippingRate,
  APIResponse 
} from '../types';

/**
 * Configuration options for the checkout hook
 */
interface UseCheckoutOptions {
  /** Initial cart ID to checkout */
  cartId?: string;
  /** Base URL for API endpoints */
  apiBaseUrl?: string;
  /** Enable automatic step progression */
  autoAdvanceSteps?: boolean;
  /** Callback when checkout is completed */
  onComplete?: (order: ElasticPathOrder) => void;
  /** Callback when checkout fails */
  onError?: (error: Error) => void;
}

/**
 * Return type for the checkout hook
 */
interface UseCheckoutReturn {
  // State
  state: CheckoutState;
  
  // Actions
  submitCustomerInfo: (data: CheckoutFormData) => Promise<void>;
  calculateShipping: (address: AddressData) => Promise<ShippingRate[]>;
  selectShippingRate: (rate: ShippingRate) => void;
  createOrder: () => Promise<ElasticPathOrder>;
  setupPayment: (orderId: string, amount: number, currency: string) => Promise<{
    clientSecret: string;
    transactionId: string;
  }>;
  confirmPayment: (orderId: string, transactionId: string, paymentIntentId: string) => Promise<ElasticPathOrder>;
  
  // Navigation
  goToStep: (step: CheckoutStep) => void;
  nextStep: () => void;
  previousStep: () => void;
  
  // Utilities
  reset: () => void;
  canProceedToNext: boolean;
  totalAmount: number;
}

/**
 * Custom hook for managing checkout flow
 */
export function useCheckout(options: UseCheckoutOptions = {}): UseCheckoutReturn {
  const {
    cartId,
    apiBaseUrl = '/api',
    autoAdvanceSteps = true,
    onComplete,
    onError
  } = options;

  // Initialize checkout state
  const [state, setState] = useState<CheckoutState>({
    currentStep: CheckoutStep.CUSTOMER_INFO,
    isLoading: false
  });

  // API helper function
  const apiCall = useCallback(async (
    endpoint: string,
    options: RequestInit = {}
  ): Promise<APIResponse<any>> => {
    const url = `${apiBaseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || `API call failed: ${response.status}`);
    }

    return data;
  }, [apiBaseUrl]);

  // Submit customer information and billing/shipping addresses
  const submitCustomerInfo = useCallback(async (data: CheckoutFormData) => {
    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      // Store customer data in state and optionally advance step
      setState(prev => ({
        ...prev,
        customerData: data.customer,
        billingAddress: data.billingAddress,
        shippingAddress: data.sameAsBilling ? data.billingAddress : data.shippingAddress,
        currentStep: autoAdvanceSteps ? CheckoutStep.SHIPPING : prev.currentStep,
        isLoading: false
      }));

    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Failed to submit customer info');
      setState(prev => ({ ...prev, error: errorObj, isLoading: false }));
      onError?.(errorObj);
      throw errorObj;
    }
  }, [autoAdvanceSteps, onError]);

  // Calculate shipping rates for the given address
  const calculateShipping = useCallback(async (address: AddressData): Promise<ShippingRate[]> => {
    if (!cartId) {
      throw new Error('Cart ID is required for shipping calculation');
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const response = await apiCall('/checkout/calculate-shipping', {
        method: 'POST',
        body: JSON.stringify({
          cartId,
          shippingAddress: address
        })
      });

      setState(prev => ({ ...prev, isLoading: false }));
      return response.data?.shippingRates || [];

    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Failed to calculate shipping');
      setState(prev => ({ ...prev, error: errorObj, isLoading: false }));
      throw errorObj;
    }
  }, [cartId, apiCall]);

  // Select a shipping rate
  const selectShippingRate = useCallback((rate: ShippingRate) => {
    setState(prev => ({ 
      ...prev, 
      selectedShippingRate: rate,
      currentStep: autoAdvanceSteps ? CheckoutStep.PAYMENT : prev.currentStep
    }));
  }, [autoAdvanceSteps]);

  // Create order from cart
  const createOrder = useCallback(async (): Promise<ElasticPathOrder> => {
    if (!cartId || !state.customerData || !state.billingAddress) {
      throw new Error('Missing required checkout data');
    }

    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const response = await apiCall('/checkout/create-order', {
        method: 'POST',
        body: JSON.stringify({
          cartId,
          customerData: state.customerData,
          billingAddress: state.billingAddress,
          shippingAddress: state.shippingAddress
        })
      });

      const order = response.data!.order;
      
      setState(prev => ({ 
        ...prev, 
        order,
        isLoading: false 
      }));

      return order;

    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Failed to create order');
      setState(prev => ({ ...prev, error: errorObj, isLoading: false }));
      onError?.(errorObj);
      throw errorObj;
    }
  }, [cartId, state.customerData, state.billingAddress, state.shippingAddress, apiCall, onError]);

  // Setup payment intent
  const setupPayment = useCallback(async (
    orderId: string, 
    amount: number, 
    currency: string
  ): Promise<{ clientSecret: string; transactionId: string }> => {
    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const response = await apiCall('/checkout/setup-payment', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          amount,
          currency
        })
      });

      const result = {
        clientSecret: response.data!.clientSecret,
        transactionId: response.data!.transactionId
      };

      setState(prev => ({ 
        ...prev, 
        paymentSetup: {
          id: response.data!.transactionId,
          type: 'transaction',
          gateway: 'stripe',
          amount,
          currency,
          status: 'pending',
          payment_intent: {
            client_secret: response.data!.clientSecret,
            payment_intent_id: response.data!.paymentIntentId || ''
          }
        },
        isLoading: false 
      }));

      return result;

    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Failed to setup payment');
      setState(prev => ({ ...prev, error: errorObj, isLoading: false }));
      onError?.(errorObj);
      throw errorObj;
    }
  }, [apiCall, onError]);

  // Confirm payment after Stripe processing
  const confirmPayment = useCallback(async (
    orderId: string,
    transactionId: string,
    paymentIntentId: string
  ): Promise<ElasticPathOrder> => {
    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const response = await apiCall('/checkout/confirm-payment', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          transactionId,
          stripePaymentIntentId: paymentIntentId
        })
      });

      const order = response.data!.order;
      
      setState(prev => ({ 
        ...prev, 
        order,
        currentStep: CheckoutStep.CONFIRMATION,
        isLoading: false 
      }));

      // Call completion callback
      onComplete?.(order);

      return order;

    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Failed to confirm payment');
      setState(prev => ({ ...prev, error: errorObj, isLoading: false }));
      onError?.(errorObj);
      throw errorObj;
    }
  }, [apiCall, onComplete, onError]);

  // Navigation functions
  const goToStep = useCallback((step: CheckoutStep) => {
    setState(prev => ({ ...prev, currentStep: step }));
  }, []);

  const nextStep = useCallback(() => {
    const steps = Object.values(CheckoutStep);
    const currentIndex = steps.indexOf(state.currentStep);
    
    if (currentIndex < steps.length - 1) {
      setState(prev => ({ ...prev, currentStep: steps[currentIndex + 1] }));
    }
  }, [state.currentStep]);

  const previousStep = useCallback(() => {
    const steps = Object.values(CheckoutStep);
    const currentIndex = steps.indexOf(state.currentStep);
    
    if (currentIndex > 0) {
      setState(prev => ({ ...prev, currentStep: steps[currentIndex - 1] }));
    }
  }, [state.currentStep]);

  // Reset checkout state
  const reset = useCallback(() => {
    setState({
      currentStep: CheckoutStep.CUSTOMER_INFO,
      isLoading: false
    });
  }, []);

  // Calculate if user can proceed to next step
  const canProceedToNext = (() => {
    switch (state.currentStep) {
      case CheckoutStep.CUSTOMER_INFO:
        return !!(state.customerData && state.billingAddress);
      
      case CheckoutStep.SHIPPING:
        return !!state.selectedShippingRate;
      
      case CheckoutStep.PAYMENT:
        return !!state.order;
      
      case CheckoutStep.CONFIRMATION:
        return false;
      
      default:
        return false;
    }
  })();

  // Calculate total amount including shipping
  const totalAmount = (() => {
    let total = 0;
    
    if (state.order) {
      total = state.order.total.amount;
    }
    
    if (state.selectedShippingRate) {
      total += state.selectedShippingRate.amount;
    }
    
    return total;
  })();

  return {
    state,
    submitCustomerInfo,
    calculateShipping,
    selectShippingRate,
    createOrder,
    setupPayment,
    confirmPayment,
    goToStep,
    nextStep,
    previousStep,
    reset,
    canProceedToNext,
    totalAmount
  };
}

export default useCheckout;