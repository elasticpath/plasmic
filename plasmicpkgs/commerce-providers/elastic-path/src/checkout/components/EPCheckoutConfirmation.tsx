import React, { useState, useCallback } from 'react';
import { EPOrderSummary } from './EPOrderSummary';
import type { ElasticPathOrder } from '../types';

interface EPCheckoutConfirmationProps {
  order: ElasticPathOrder;
  onContinueShopping?: () => void;
  onPrintOrder?: () => void;
  className?: string;
  style?: React.CSSProperties;
  showOrderSummary?: boolean;
  customSuccessMessage?: string;
  showPrintButton?: boolean;
  showContinueButton?: boolean;
}

export function EPCheckoutConfirmation({
  order,
  onContinueShopping,
  onPrintOrder,
  className,
  style,
  showOrderSummary = true,
  customSuccessMessage,
  showPrintButton = true,
  showContinueButton = true
}: EPCheckoutConfirmationProps) {
  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = useCallback(async () => {
    if (onPrintOrder) {
      setIsPrinting(true);
      try {
        await onPrintOrder();
      } catch (error) {
        console.error('Print error:', error);
      } finally {
        setIsPrinting(false);
      }
    } else {
      // Default print behavior
      window.print();
    }
  }, [onPrintOrder]);

  const getSuccessMessage = () => {
    if (customSuccessMessage) {
      return customSuccessMessage;
    }

    switch (order.payment) {
      case 'paid':
        return 'Your order has been successfully placed and payment has been processed!';
      case 'authorized':
        return 'Your order has been placed and payment has been authorized. Your card will be charged when the order ships.';
      case 'pending':
        return 'Your order has been placed and is being processed. You will receive confirmation once payment is complete.';
      default:
        return 'Your order has been successfully placed!';
    }
  };

  const getStatusIcon = () => {
    switch (order.payment) {
      case 'paid':
        return '✅';
      case 'authorized':
        return '🔄';
      case 'pending':
        return '⏳';
      case 'failed':
        return '❌';
      default:
        return '📝';
    }
  };

  const shouldShowEmailMessage = () => {
    return order.customer?.email && (order.payment === 'paid' || order.payment === 'authorized');
  };

  return (
    <div className={`ep-checkout-confirmation ${className || ''}`} style={style}>
      {/* Success Header */}
      <div className="ep-confirmation-header">
        <div className="ep-success-icon">{getStatusIcon()}</div>
        <h2 className="ep-success-title">Order Confirmed!</h2>
        <p className="ep-success-message">{getSuccessMessage()}</p>
      </div>

      {/* Order Details */}
      <div className="ep-confirmation-details">
        <div className="ep-order-reference">
          <h3>Order Reference</h3>
          <div className="ep-reference-number">#{order.id}</div>
          {order.meta?.timestamps?.created_at && (
            <div className="ep-order-date">
              Placed on {formatDate(order.meta.timestamps.created_at)}
            </div>
          )}
        </div>

        {/* Email Confirmation Message */}
        {shouldShowEmailMessage() && (
          <div className="ep-email-confirmation">
            <p>
              A confirmation email has been sent to{' '}
              <strong>{order.customer!.email}</strong>
            </p>
          </div>
        )}

        {/* Payment Status Details */}
        <div className="ep-payment-details">
          <h3>Payment Status</h3>
          <div className={`ep-payment-status ep-payment-${order.payment}`}>
            {formatPaymentStatus(order.payment)}
          </div>
          
          {order.payment === 'paid' && (
            <p className="ep-payment-note">
              Your payment has been successfully processed.
            </p>
          )}
          
          {order.payment === 'authorized' && (
            <p className="ep-payment-note">
              Your payment has been authorized. You will be charged when your order ships.
            </p>
          )}
          
          {order.payment === 'pending' && (
            <p className="ep-payment-note">
              Your payment is being processed. You will receive an update shortly.
            </p>
          )}
        </div>

        {/* Shipping Information */}
        {order.shipping_address && (
          <div className="ep-shipping-info">
            <h3>Shipping Information</h3>
            <div className="ep-shipping-address">
              <AddressDisplay address={order.shipping_address} />
            </div>
            {/* You could add estimated delivery date here if available */}
          </div>
        )}

        {/* What's Next */}
        <div className="ep-next-steps">
          <h3>What's Next?</h3>
          <ul className="ep-steps-list">
            {order.payment === 'paid' && (
              <>
                <li>We'll prepare your order for shipping</li>
                <li>You'll receive a tracking number via email</li>
                <li>Your order will be delivered to the address above</li>
              </>
            )}
            {order.payment === 'authorized' && (
              <>
                <li>We'll verify your order details</li>
                <li>Your payment will be processed when we ship</li>
                <li>You'll receive shipping confirmation via email</li>
              </>
            )}
            {order.payment === 'pending' && (
              <>
                <li>We're processing your payment</li>
                <li>You'll receive confirmation once complete</li>
                <li>We'll then prepare your order for shipping</li>
              </>
            )}
          </ul>
        </div>
      </div>

      {/* Order Summary */}
      {showOrderSummary && (
        <div className="ep-confirmation-order-summary">
          <EPOrderSummary 
            order={order} 
            showTitle={false}
            compact={true}
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="ep-confirmation-actions">
        {showPrintButton && (
          <button
            type="button"
            onClick={handlePrint}
            disabled={isPrinting}
            className="ep-print-button"
          >
            {isPrinting ? 'Printing...' : 'Print Order'}
          </button>
        )}
        
        {showContinueButton && (
          <button
            type="button"
            onClick={onContinueShopping}
            className="ep-continue-button"
          >
            Continue Shopping
          </button>
        )}
      </div>

      {/* Support Information */}
      <div className="ep-support-info">
        <p>
          Need help with your order? Contact us with your order reference number.
        </p>
      </div>
    </div>
  );
}

interface AddressDisplayProps {
  address: any;
}

function AddressDisplay({ address }: AddressDisplayProps) {
  if (!address) return null;

  return (
    <div className="ep-address-display">
      {address.first_name && address.last_name && (
        <div className="ep-address-name">
          {address.first_name} {address.last_name}
        </div>
      )}
      <div className="ep-address-line">{address.line_1}</div>
      {address.line_2 && (
        <div className="ep-address-line">{address.line_2}</div>
      )}
      <div className="ep-address-line">
        {address.city}
        {address.county && `, ${address.county}`}
        {address.postcode && ` ${address.postcode}`}
      </div>
      {address.country && (
        <div className="ep-address-line">{getCountryName(address.country)}</div>
      )}
    </div>
  );
}

function formatPaymentStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'pending': 'Payment Pending',
    'authorized': 'Payment Authorized',
    'paid': 'Payment Complete',
    'cancelled': 'Payment Cancelled',
    'failed': 'Payment Failed',
    'refunded': 'Payment Refunded'
  };
  
  return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
}

function getCountryName(countryCode: string): string {
  const countryMap: Record<string, string> = {
    'US': 'United States',
    'CA': 'Canada',
    'GB': 'United Kingdom',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'NL': 'Netherlands',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark'
  };
  
  return countryMap[countryCode] || countryCode;
}

export default EPCheckoutConfirmation;