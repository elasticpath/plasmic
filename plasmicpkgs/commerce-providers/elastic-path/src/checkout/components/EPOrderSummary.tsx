import React from 'react';
import { formatCurrencyFromCents } from '../../utils/formatCurrency';
import type { ElasticPathOrder } from '../types';

interface EPOrderSummaryProps {
  order?: ElasticPathOrder;
  className?: string;
  style?: React.CSSProperties;
  showTitle?: boolean;
  showItems?: boolean;
  showCustomer?: boolean;
  showAddresses?: boolean;
  compact?: boolean;
}

export function EPOrderSummary({
  order,
  className,
  style,
  showTitle = true,
  showItems = true,
  showCustomer = true,
  showAddresses = true,
  compact = false
}: EPOrderSummaryProps) {
  if (!order) {
    return (
      <div className={className} style={style}>
        <div className="ep-order-summary-placeholder">
          No order information available
        </div>
      </div>
    );
  }

  const items = order.meta?.items || [];

  return (
    <div className={`ep-order-summary ${compact ? 'compact' : ''} ${className || ''}`} style={style}>
      {showTitle && (
        <div className="ep-order-header">
          <h3>Order Summary</h3>
          <div className="ep-order-id">Order #{order.id}</div>
        </div>
      )}

      {/* Order Items */}
      {showItems && items.length > 0 && (
        <div className="ep-order-items">
          <h4>Items ({items.length})</h4>
          <div className="ep-items-list">
            {items.map((item: any, index: number) => (
              <div key={item.id || index} className="ep-item">
                <div className="ep-item-details">
                  <div className="ep-item-name">{item.name || 'Product'}</div>
                  {item.sku && (
                    <div className="ep-item-sku">SKU: {item.sku}</div>
                  )}
                  <div className="ep-item-quantity">Qty: {item.quantity || 1}</div>
                </div>
                <div className="ep-item-price">
                  {formatCurrencyFromCents(
                    item.meta?.display_price?.with_tax?.unit?.amount || 0,
                    item.meta?.display_price?.with_tax?.unit?.currency || order.total.currency
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price Breakdown */}
      <div className="ep-price-breakdown">
        <div className="ep-price-line">
          <span>Subtotal:</span>
          <span>{formatCurrencyFromCents(order.subtotal.amount, order.subtotal.currency)}</span>
        </div>
        
        {order.tax.amount > 0 && (
          <div className="ep-price-line">
            <span>Tax:</span>
            <span>{formatCurrencyFromCents(order.tax.amount, order.tax.currency)}</span>
          </div>
        )}
        
        {order.shipping && order.shipping.amount > 0 && (
          <div className="ep-price-line">
            <span>Shipping:</span>
            <span>{formatCurrencyFromCents(order.shipping.amount, order.shipping.currency)}</span>
          </div>
        )}
        
        <div className="ep-price-line ep-total">
          <span>Total:</span>
          <span>{formatCurrencyFromCents(order.total.amount, order.total.currency)}</span>
        </div>
      </div>

      {/* Customer Information */}
      {showCustomer && order.customer && !compact && (
        <div className="ep-customer-info">
          <h4>Customer</h4>
          <div className="ep-customer-details">
            <div className="ep-customer-name">{order.customer.name}</div>
            <div className="ep-customer-email">{order.customer.email}</div>
          </div>
        </div>
      )}

      {/* Addresses */}
      {showAddresses && !compact && (
        <div className="ep-addresses">
          {order.billing_address && (
            <div className="ep-address-section">
              <h4>Billing Address</h4>
              <div className="ep-address">
                <AddressDisplay address={order.billing_address} />
              </div>
            </div>
          )}
          
          {order.shipping_address && (
            <div className="ep-address-section">
              <h4>Shipping Address</h4>
              <div className="ep-address">
                <AddressDisplay address={order.shipping_address} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order Status and Payment */}
      <div className="ep-order-status">
        <div className="ep-status-line">
          <span>Order Status:</span>
          <span className={`ep-status ep-status-${order.status}`}>
            {formatStatus(order.status)}
          </span>
        </div>
        
        <div className="ep-status-line">
          <span>Payment:</span>
          <span className={`ep-payment-status ep-payment-${order.payment}`}>
            {formatPaymentStatus(order.payment)}
          </span>
        </div>
        
        {order.meta?.timestamps?.created_at && (
          <div className="ep-status-line">
            <span>Order Date:</span>
            <span>{formatDate(order.meta.timestamps.created_at)}</span>
          </div>
        )}
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
        <div>{address.first_name} {address.last_name}</div>
      )}
      <div>{address.line_1}</div>
      {address.line_2 && <div>{address.line_2}</div>}
      <div>
        {address.city}
        {address.county && `, ${address.county}`}
        {address.postcode && ` ${address.postcode}`}
      </div>
      {address.country && <div>{getCountryName(address.country)}</div>}
    </div>
  );
}

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'incomplete': 'Incomplete',
    'processing': 'Processing',
    'complete': 'Complete',
    'cancelled': 'Cancelled',
    'partially_authorized': 'Partially Authorized',
    'partially_paid': 'Partially Paid'
  };
  
  return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
}

function formatPaymentStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'pending': 'Pending',
    'authorized': 'Authorized',
    'paid': 'Paid',
    'cancelled': 'Cancelled',
    'failed': 'Failed',
    'refunded': 'Refunded'
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

export default EPOrderSummary;