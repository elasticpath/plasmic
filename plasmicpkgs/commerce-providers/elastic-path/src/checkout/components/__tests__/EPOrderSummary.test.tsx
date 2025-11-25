import React from 'react';
import { render, screen } from '@testing-library/react';
import { EPOrderSummary } from '../EPOrderSummary';
import type { ElasticPathOrder } from '../../types';

const mockOrder: ElasticPathOrder = {
  id: 'order-123',
  type: 'order',
  status: 'complete',
  payment: 'paid',
  total: {
    amount: 2500,
    currency: 'USD'
  },
  subtotal: {
    amount: 2000,
    currency: 'USD'
  },
  tax: {
    amount: 200,
    currency: 'USD'
  },
  shipping: {
    amount: 300,
    currency: 'USD'
  },
  customer: {
    name: 'John Doe',
    email: 'john@example.com'
  },
  billing_address: {
    first_name: 'John',
    last_name: 'Doe',
    line_1: '123 Main St',
    line_2: 'Apt 4B',
    city: 'New York',
    county: 'NY',
    country: 'US',
    postcode: '10001'
  },
  shipping_address: {
    first_name: 'Jane',
    last_name: 'Smith',
    line_1: '456 Oak Ave',
    city: 'Boston',
    county: 'MA',
    country: 'US',
    postcode: '02101'
  },
  relationships: {
    items: {
      data: [
        { type: 'item', id: 'item-1' },
        { type: 'item', id: 'item-2' }
      ]
    }
  },
  meta: {
    items: [
      {
        id: 'item-1',
        name: 'Product 1',
        sku: 'SKU-001',
        quantity: 2,
        meta: {
          display_price: {
            with_tax: {
              unit: { amount: 1000, currency: 'USD' }
            }
          }
        }
      },
      {
        id: 'item-2',
        name: 'Product 2',
        sku: 'SKU-002',
        quantity: 1,
        meta: {
          display_price: {
            with_tax: {
              unit: { amount: 500, currency: 'USD' }
            }
          }
        }
      }
    ],
    timestamps: {
      created_at: '2024-01-15T10:30:00Z',
      updated_at: '2024-01-15T10:35:00Z'
    }
  }
};

describe('EPOrderSummary', () => {
  describe('Rendering', () => {
    it('should render basic order information', () => {
      render(<EPOrderSummary order={mockOrder} />);

      expect(screen.getByText('Order Summary')).toBeInTheDocument();
      expect(screen.getByText('Order #order-123')).toBeInTheDocument();
    });

    it('should render without order data', () => {
      render(<EPOrderSummary />);

      expect(screen.getByText('No order information available')).toBeInTheDocument();
    });

    it('should hide title when showTitle is false', () => {
      render(<EPOrderSummary order={mockOrder} showTitle={false} />);

      expect(screen.queryByText('Order Summary')).not.toBeInTheDocument();
      expect(screen.getByText('Order #order-123')).toBeInTheDocument(); // Order ID should still show
    });
  });

  describe('Price Display', () => {
    it('should display price breakdown correctly', () => {
      render(<EPOrderSummary order={mockOrder} />);

      expect(screen.getByText('$20.00')).toBeInTheDocument(); // Subtotal
      expect(screen.getByText('$2.00')).toBeInTheDocument(); // Tax
      expect(screen.getByText('$3.00')).toBeInTheDocument(); // Shipping
      expect(screen.getByText('$25.00')).toBeInTheDocument(); // Total
    });

    it('should handle zero tax amount', () => {
      const orderWithoutTax = {
        ...mockOrder,
        tax: { amount: 0, currency: 'USD' }
      };

      render(<EPOrderSummary order={orderWithoutTax} />);

      expect(screen.queryByText('Tax:')).not.toBeInTheDocument();
    });

    it('should handle missing shipping', () => {
      const orderWithoutShipping = {
        ...mockOrder,
        shipping: undefined
      };

      render(<EPOrderSummary order={orderWithoutShipping} />);

      expect(screen.queryByText('Shipping:')).not.toBeInTheDocument();
    });
  });

  describe('Items Display', () => {
    it('should show items when showItems is true', () => {
      render(<EPOrderSummary order={mockOrder} showItems={true} />);

      expect(screen.getByText('Items (2)')).toBeInTheDocument();
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Product 2')).toBeInTheDocument();
      expect(screen.getByText('SKU: SKU-001')).toBeInTheDocument();
      expect(screen.getByText('Qty: 2')).toBeInTheDocument();
    });

    it('should hide items when showItems is false', () => {
      render(<EPOrderSummary order={mockOrder} showItems={false} />);

      expect(screen.queryByText('Items (2)')).not.toBeInTheDocument();
      expect(screen.queryByText('Product 1')).not.toBeInTheDocument();
    });

    it('should handle missing items gracefully', () => {
      const orderWithoutItems = {
        ...mockOrder,
        meta: {}
      };

      render(<EPOrderSummary order={orderWithoutItems} />);

      expect(screen.queryByText('Items')).not.toBeInTheDocument();
    });
  });

  describe('Customer Information', () => {
    it('should show customer info when showCustomer is true', () => {
      render(<EPOrderSummary order={mockOrder} showCustomer={true} />);

      expect(screen.getByText('Customer')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    it('should hide customer info when showCustomer is false', () => {
      render(<EPOrderSummary order={mockOrder} showCustomer={false} />);

      expect(screen.queryByText('Customer')).not.toBeInTheDocument();
    });

    it('should hide customer section when no customer data', () => {
      const orderWithoutCustomer = {
        ...mockOrder,
        customer: undefined
      };

      render(<EPOrderSummary order={orderWithoutCustomer} />);

      expect(screen.queryByText('Customer')).not.toBeInTheDocument();
    });
  });

  describe('Addresses Display', () => {
    it('should show addresses when showAddresses is true', () => {
      render(<EPOrderSummary order={mockOrder} showAddresses={true} />);

      expect(screen.getByText('Billing Address')).toBeInTheDocument();
      expect(screen.getByText('Shipping Address')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('123 Main St')).toBeInTheDocument();
      expect(screen.getByText('456 Oak Ave')).toBeInTheDocument();
    });

    it('should hide addresses when showAddresses is false', () => {
      render(<EPOrderSummary order={mockOrder} showAddresses={false} />);

      expect(screen.queryByText('Billing Address')).not.toBeInTheDocument();
      expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();
    });

    it('should handle missing addresses', () => {
      const orderWithoutAddresses = {
        ...mockOrder,
        billing_address: undefined,
        shipping_address: undefined
      };

      render(<EPOrderSummary order={orderWithoutAddresses} />);

      expect(screen.queryByText('Billing Address')).not.toBeInTheDocument();
      expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();
    });
  });

  describe('Compact Mode', () => {
    it('should hide customer and addresses in compact mode', () => {
      render(<EPOrderSummary order={mockOrder} compact={true} />);

      expect(screen.queryByText('Customer')).not.toBeInTheDocument();
      expect(screen.queryByText('Billing Address')).not.toBeInTheDocument();
      expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();
    });

    it('should still show items and pricing in compact mode', () => {
      render(<EPOrderSummary order={mockOrder} compact={true} />);

      expect(screen.getByText('Items (2)')).toBeInTheDocument();
      expect(screen.getByText('$25.00')).toBeInTheDocument();
    });
  });

  describe('Status Display', () => {
    it('should display order and payment status', () => {
      render(<EPOrderSummary order={mockOrder} />);

      expect(screen.getByText('Order Status:')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
      expect(screen.getByText('Payment:')).toBeInTheDocument();
      expect(screen.getByText('Paid')).toBeInTheDocument();
    });

    it('should format status strings correctly', () => {
      const orderWithDifferentStatus = {
        ...mockOrder,
        status: 'partially_paid',
        payment: 'authorized'
      };

      render(<EPOrderSummary order={orderWithDifferentStatus} />);

      expect(screen.getByText('Partially Paid')).toBeInTheDocument();
      expect(screen.getByText('Authorized')).toBeInTheDocument();
    });

    it('should display order date when available', () => {
      render(<EPOrderSummary order={mockOrder} />);

      expect(screen.getByText('Order Date:')).toBeInTheDocument();
      expect(screen.getByText(/January 15, 2024/)).toBeInTheDocument();
    });
  });

  describe('Address Formatting', () => {
    it('should format addresses correctly', () => {
      render(<EPOrderSummary order={mockOrder} />);

      // Billing address
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('123 Main St')).toBeInTheDocument();
      expect(screen.getByText('Apt 4B')).toBeInTheDocument();
      expect(screen.getByText('New York, NY 10001')).toBeInTheDocument();
      expect(screen.getByText('United States')).toBeInTheDocument();

      // Shipping address  
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('456 Oak Ave')).toBeInTheDocument();
      expect(screen.getByText('Boston, MA 02101')).toBeInTheDocument();
    });

    it('should handle addresses without optional fields', () => {
      const orderWithMinimalAddress = {
        ...mockOrder,
        billing_address: {
          first_name: 'John',
          last_name: 'Doe',
          line_1: '123 Main St',
          city: 'New York',
          country: 'US',
          postcode: '10001'
        }
      };

      render(<EPOrderSummary order={orderWithMinimalAddress} />);

      expect(screen.getByText('New York 10001')).toBeInTheDocument();
    });
  });

  describe('Currency Formatting', () => {
    it('should handle different currencies', () => {
      const eurOrder = {
        ...mockOrder,
        total: { amount: 2500, currency: 'EUR' },
        subtotal: { amount: 2000, currency: 'EUR' }
      };

      render(<EPOrderSummary order={eurOrder} />);

      expect(screen.getByText('€25.00')).toBeInTheDocument();
      expect(screen.getByText('€20.00')).toBeInTheDocument();
    });

    it('should fallback to basic formatting for invalid currencies', () => {
      const invalidCurrencyOrder = {
        ...mockOrder,
        total: { amount: 2500, currency: 'INVALID' }
      };

      render(<EPOrderSummary order={invalidCurrencyOrder} />);

      expect(screen.getByText('INVALID 25.00')).toBeInTheDocument();
    });
  });

  describe('Custom Props', () => {
    it('should apply custom className and style', () => {
      render(
        <EPOrderSummary
          order={mockOrder}
          className="custom-class"
          style={{ backgroundColor: 'red' }}
        />
      );

      const container = screen.getByText('Order Summary').closest('.ep-order-summary');
      expect(container).toHaveClass('custom-class');
      expect(container).toHaveStyle('background-color: red');
    });

    it('should apply compact class when in compact mode', () => {
      render(<EPOrderSummary order={mockOrder} compact={true} />);

      const container = screen.getByText('Order #order-123').closest('.ep-order-summary');
      expect(container).toHaveClass('compact');
    });
  });
});