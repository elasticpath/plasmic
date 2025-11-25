import { useState, useEffect, useCallback } from 'react';
import { loadStripe, Stripe, StripeElements } from '@stripe/stripe-js';

/**
 * Configuration options for the Stripe payment hook
 */
interface UseStripePaymentOptions {
  /** Stripe publishable key */
  stripePublishableKey: string;
  /** Client secret from payment intent */
  clientSecret?: string;
  /** Appearance customization for Stripe Elements */
  appearance?: {
    theme?: 'stripe' | 'night' | 'flat';
    variables?: Record<string, string>;
  };
  /** Callback when payment succeeds */
  onSuccess?: (paymentIntent: any) => void;
  /** Callback when payment fails */
  onError?: (error: Error) => void;
}

/**
 * Payment method types supported by Stripe
 */
type PaymentMethodType = 'card' | 'ideal' | 'sepa_debit' | 'sofort' | 'bancontact';

/**
 * Return type for the Stripe payment hook
 */
interface UseStripePaymentReturn {
  // Stripe instances
  stripe: Stripe | null;
  elements: StripeElements | null;
  
  // State
  isLoading: boolean;
  isProcessing: boolean;
  error: Error | null;
  paymentIntentStatus: string | null;
  
  // Actions
  initializeElements: (clientSecret: string) => Promise<void>;
  confirmPayment: (options?: {
    return_url?: string;
    payment_method_data?: any;
  }) => Promise<{ paymentIntent: any; error?: any }>;
  
  // Utilities
  reset: () => void;
  getElementsOptions: () => any;
}

/**
 * Custom hook for managing Stripe payment processing
 */
export function useStripePayment(options: UseStripePaymentOptions): UseStripePaymentReturn {
  const {
    stripePublishableKey,
    clientSecret,
    appearance = { theme: 'stripe' },
    onSuccess,
    onError
  } = options;

  // State
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [paymentIntentStatus, setPaymentIntentStatus] = useState<string | null>(null);

  // Initialize Stripe
  useEffect(() => {
    if (!stripePublishableKey) {
      setError(new Error('Stripe publishable key is required'));
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const initializeStripe = async () => {
      try {
        const stripeInstance = await loadStripe(stripePublishableKey);
        
        if (isMounted) {
          if (!stripeInstance) {
            throw new Error('Failed to initialize Stripe');
          }
          
          setStripe(stripeInstance);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          const error = err instanceof Error ? err : new Error('Failed to load Stripe');
          setError(error);
          onError?.(error);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initializeStripe();

    return () => {
      isMounted = false;
    };
  }, [stripePublishableKey, onError]);

  // Initialize Elements when client secret is available
  const initializeElements = useCallback(async (clientSecret: string) => {
    if (!stripe) {
      throw new Error('Stripe not initialized');
    }

    if (!clientSecret) {
      throw new Error('Client secret is required');
    }

    setIsLoading(true);
    setError(null);

    try {
      const elementsOptions = getElementsOptions(clientSecret);
      const elementsInstance = stripe.elements(elementsOptions);
      
      setElements(elementsInstance);
      setPaymentIntentStatus('requires_payment_method');
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to initialize Elements');
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [stripe, appearance, onError]);

  // Auto-initialize elements when client secret is provided
  useEffect(() => {
    if (stripe && clientSecret && !elements) {
      initializeElements(clientSecret).catch(() => {
        // Error is already handled in initializeElements
      });
    }
  }, [stripe, clientSecret, elements, initializeElements]);

  // Confirm payment
  const confirmPayment = useCallback(async (options: {
    return_url?: string;
    payment_method_data?: any;
  } = {}) => {
    if (!stripe || !elements) {
      throw new Error('Stripe and Elements must be initialized');
    }

    if (!clientSecret) {
      throw new Error('Client secret is required');
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Get the payment element
      const paymentElement = elements.getElement('payment');
      
      if (!paymentElement) {
        throw new Error('Payment element not found');
      }

      // Confirm the payment
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: options.return_url || window.location.href,
          ...options.payment_method_data && {
            payment_method_data: options.payment_method_data
          }
        },
        redirect: 'if_required'
      });

      if (confirmError) {
        throw new Error(confirmError.message || 'Payment confirmation failed');
      }

      if (paymentIntent) {
        setPaymentIntentStatus(paymentIntent.status);
        
        if (paymentIntent.status === 'succeeded') {
          onSuccess?.(paymentIntent);
        }
        
        return { paymentIntent };
      }

      throw new Error('No payment intent returned');

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Payment failed');
      setError(error);
      onError?.(error);
      return { error, paymentIntent: null };
    } finally {
      setIsProcessing(false);
    }
  }, [stripe, elements, clientSecret, onSuccess, onError]);

  // Reset state
  const reset = useCallback(() => {
    setElements(null);
    setError(null);
    setPaymentIntentStatus(null);
    setIsProcessing(false);
  }, []);

  // Get Elements options
  const getElementsOptions = useCallback((clientSecret?: string) => {
    return {
      clientSecret: clientSecret || undefined,
      appearance: {
        theme: appearance.theme || 'stripe',
        variables: {
          colorPrimary: '#0570de',
          colorBackground: '#ffffff',
          colorText: '#30313d',
          colorDanger: '#df1b41',
          fontFamily: 'system-ui, sans-serif',
          spacingUnit: '4px',
          borderRadius: '6px',
          ...appearance.variables
        }
      },
      loader: 'auto' as const
    };
  }, [appearance]);

  return {
    stripe,
    elements,
    isLoading,
    isProcessing,
    error,
    paymentIntentStatus,
    initializeElements,
    confirmPayment,
    reset,
    getElementsOptions: () => getElementsOptions(clientSecret)
  };
}

/**
 * Hook for handling specific payment method types
 */
export function usePaymentMethod(
  paymentMethodType: PaymentMethodType,
  stripeOptions: UseStripePaymentOptions
) {
  const stripeHook = useStripePayment(stripeOptions);
  
  // Payment method specific configurations
  const getPaymentMethodConfig = useCallback(() => {
    const configs = {
      card: {
        layout: 'tabs',
        defaultValues: {
          billingDetails: {
            address: {
              country: 'US'
            }
          }
        }
      },
      ideal: {
        layout: 'tabs'
      },
      sepa_debit: {
        layout: 'tabs'
      },
      sofort: {
        layout: 'tabs'
      },
      bancontact: {
        layout: 'tabs'
      }
    };

    return configs[paymentMethodType] || configs.card;
  }, [paymentMethodType]);

  return {
    ...stripeHook,
    paymentMethodType,
    paymentMethodConfig: getPaymentMethodConfig()
  };
}

/**
 * Utility function to validate Stripe public key format
 */
export function validateStripePublishableKey(key: string): boolean {
  return key.startsWith('pk_') && key.length > 20;
}

/**
 * Utility function to format Stripe errors for user display
 */
export function formatStripeError(error: any): string {
  if (!error) return 'An unknown error occurred';

  // Map common Stripe error codes to user-friendly messages
  const errorMessages: Record<string, string> = {
    'card_declined': 'Your card was declined. Please try a different card.',
    'expired_card': 'Your card has expired. Please try a different card.',
    'incorrect_cvc': 'Your card\'s security code is incorrect.',
    'insufficient_funds': 'Your card has insufficient funds.',
    'invalid_expiry_month': 'Your card\'s expiration month is invalid.',
    'invalid_expiry_year': 'Your card\'s expiration year is invalid.',
    'invalid_number': 'Your card number is invalid.',
    'invalid_cvc': 'Your card\'s security code is invalid.',
    'processing_error': 'An error occurred processing your card. Please try again.',
    'rate_limit': 'Too many requests. Please try again in a moment.'
  };

  const code = error.code || error.type;
  return errorMessages[code] || error.message || 'Payment processing failed. Please try again.';
}

export default useStripePayment;