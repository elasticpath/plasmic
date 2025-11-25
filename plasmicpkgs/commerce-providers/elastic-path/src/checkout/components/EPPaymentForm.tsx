import React, { useState, useEffect, useCallback } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useStripePayment } from '../hooks/use-stripe-payment';
import { useCheckout } from '../hooks/use-checkout';
import type { ElasticPathOrder } from '../types';

interface EPPaymentFormProps {
  order: ElasticPathOrder;
  stripePublishableKey: string;
  apiBaseUrl?: string;
  onSuccess?: (order: ElasticPathOrder) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: React.CSSProperties;
  theme?: 'stripe' | 'night' | 'flat';
}

interface PaymentFormInternalProps {
  order: ElasticPathOrder;
  clientSecret: string;
  onSuccess?: (order: ElasticPathOrder) => void;
  onError?: (error: Error) => void;
  apiBaseUrl?: string;
  className?: string;
  style?: React.CSSProperties;
}

function PaymentFormInternal({
  order,
  clientSecret,
  onSuccess,
  onError,
  apiBaseUrl,
  className,
  style
}: PaymentFormInternalProps) {
  const stripe = useStripe();
  const elements = useElements();
  const checkout = useCheckout({ apiBaseUrl });
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      setErrorMessage('Payment system not ready. Please try again.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // Confirm the payment
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: window.location.href
        }
      });

      if (stripeError) {
        throw new Error(stripeError.message || 'Payment failed');
      }

      if (!paymentIntent) {
        throw new Error('No payment intent returned');
      }

      if (paymentIntent.status !== 'succeeded') {
        throw new Error(`Payment not completed. Status: ${paymentIntent.status}`);
      }

      // Confirm payment with our backend
      const confirmedOrder = await checkout.confirmPayment(
        order.id,
        checkout.state.paymentSetup?.id || '',
        paymentIntent.id
      );

      onSuccess?.(confirmedOrder);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Payment failed';
      setErrorMessage(errorMsg);
      onError?.(error instanceof Error ? error : new Error(errorMsg));
    } finally {
      setIsProcessing(false);
    }
  }, [stripe, elements, order.id, checkout, onSuccess, onError]);

  const paymentElementOptions = {
    layout: 'tabs' as const,
    defaultValues: {
      billingDetails: {
        name: order.customer?.name || '',
        email: order.customer?.email || '',
        address: order.billing_address ? {
          line1: order.billing_address.line_1,
          line2: order.billing_address.line_2 || '',
          city: order.billing_address.city,
          state: order.billing_address.county || '',
          postal_code: order.billing_address.postcode,
          country: order.billing_address.country
        } : undefined
      }
    }
  };

  return (
    <div className={className} style={style}>
      <form onSubmit={handleSubmit}>
        <div className="ep-payment-section">
          <h3>Payment Information</h3>
          
          <div className="ep-payment-element">
            <PaymentElement options={paymentElementOptions} />
          </div>
          
          {errorMessage && (
            <div className="ep-error-message">
              {errorMessage}
            </div>
          )}

          <div className="ep-order-summary">
            <h4>Order Summary</h4>
            <div className="ep-summary-line">
              <span>Subtotal:</span>
              <span>{formatCurrency(order.subtotal.amount, order.subtotal.currency)}</span>
            </div>
            {order.tax.amount > 0 && (
              <div className="ep-summary-line">
                <span>Tax:</span>
                <span>{formatCurrency(order.tax.amount, order.tax.currency)}</span>
              </div>
            )}
            {order.shipping && (
              <div className="ep-summary-line">
                <span>Shipping:</span>
                <span>{formatCurrency(order.shipping.amount, order.shipping.currency)}</span>
              </div>
            )}
            <div className="ep-summary-line ep-total">
              <span>Total:</span>
              <span>{formatCurrency(order.total.amount, order.total.currency)}</span>
            </div>
          </div>

          <div className="ep-payment-actions">
            <button
              type="submit"
              disabled={!stripe || !elements || isProcessing}
              className="ep-pay-button"
            >
              {isProcessing 
                ? 'Processing...' 
                : `Pay ${formatCurrency(order.total.amount, order.total.currency)}`
              }
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function EPPaymentForm({
  order,
  stripePublishableKey,
  apiBaseUrl,
  onSuccess,
  onError,
  className,
  style,
  theme = 'stripe'
}: EPPaymentFormProps) {
  const [stripePromise, setStripePromise] = useState<Promise<any> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const checkout = useCheckout({ apiBaseUrl });

  // Initialize Stripe
  useEffect(() => {
    if (stripePublishableKey && !stripePromise) {
      setStripePromise(loadStripe(stripePublishableKey));
    }
  }, [stripePublishableKey, stripePromise]);

  // Setup payment intent
  useEffect(() => {
    if (order && !clientSecret && !isSettingUp) {
      setupPaymentIntent();
    }
  }, [order, clientSecret, isSettingUp]);

  const setupPaymentIntent = useCallback(async () => {
    setIsSettingUp(true);
    setSetupError(null);

    try {
      const result = await checkout.setupPayment(
        order.id,
        order.total.amount,
        order.total.currency
      );
      
      setClientSecret(result.clientSecret);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to setup payment';
      setSetupError(errorMsg);
      onError?.(error instanceof Error ? error : new Error(errorMsg));
    } finally {
      setIsSettingUp(false);
    }
  }, [order, checkout, onError]);

  const appearance = {
    theme: theme,
    variables: {
      colorPrimary: '#0570de',
      colorBackground: '#ffffff',
      colorText: '#30313d',
      colorDanger: '#df1b41',
      fontFamily: 'system-ui, sans-serif',
      spacingUnit: '4px',
      borderRadius: '6px'
    }
  };

  const options = {
    clientSecret: clientSecret || undefined,
    appearance
  };

  if (setupError) {
    return (
      <div className={className} style={style}>
        <div className="ep-error-message">
          Payment setup failed: {setupError}
          <button 
            onClick={setupPaymentIntent}
            className="ep-retry-button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isSettingUp || !clientSecret) {
    return (
      <div className={className} style={style}>
        <div className="ep-loading-message">
          Setting up payment...
        </div>
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className={className} style={style}>
        <div className="ep-error-message">
          Payment system not available. Please check your Stripe configuration.
        </div>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentFormInternal
        order={order}
        clientSecret={clientSecret}
        onSuccess={onSuccess}
        onError={onError}
        apiBaseUrl={apiBaseUrl}
        className={className}
        style={style}
      />
    </Elements>
  );
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
  } catch {
    return `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;
  }
}

export default EPPaymentForm;