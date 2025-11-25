import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EPCheckoutForm } from '../EPCheckoutForm';
import { useCheckout } from '../../hooks/use-checkout';

// Mock the useCheckout hook
jest.mock('../../hooks/use-checkout');
const mockUseCheckout = useCheckout as jest.MockedFunction<typeof useCheckout>;

describe('EPCheckoutForm', () => {
  const mockCheckout = {
    state: {
      currentStep: 'customer_info',
      isLoading: false,
      error: undefined
    },
    submitCustomerInfo: jest.fn(),
    canProceedToNext: false
  };

  beforeEach(() => {
    mockUseCheckout.mockReturnValue(mockCheckout as any);
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render customer information section', () => {
      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByText('Customer Information')).toBeInTheDocument();
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it('should render billing address section', () => {
      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByText('Billing Address')).toBeInTheDocument();
      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/address line 1/i)).toBeInTheDocument();
    });

    it('should render shipping address toggle', () => {
      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByLabelText(/shipping address same as billing/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/shipping address same as billing/i)).toBeChecked();
    });

    it('should not render shipping address fields when same as billing', () => {
      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();
    });

    it('should render shipping address fields when different from billing', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      const checkbox = screen.getByLabelText(/shipping address same as billing/i);
      await user.click(checkbox);

      expect(screen.getByText('Shipping Address')).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('should show error for empty required fields', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      const submitButton = screen.getByRole('button', { name: /continue to shipping/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
        expect(screen.getByText('Email is required')).toBeInTheDocument();
      });
    });

    it('should validate email format', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'invalid-email');

      const submitButton = screen.getByRole('button', { name: /continue to shipping/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
      });
    });

    it('should validate billing address fields', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      const submitButton = screen.getByRole('button', { name: /continue to shipping/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('First name is required')).toBeInTheDocument();
        expect(screen.getByText('Last name is required')).toBeInTheDocument();
        expect(screen.getByText('Address line 1 is required')).toBeInTheDocument();
        expect(screen.getByText('City is required')).toBeInTheDocument();
        expect(screen.getByText('Country is required')).toBeInTheDocument();
        expect(screen.getByText('Postal code is required')).toBeInTheDocument();
      });
    });

    it('should validate shipping address when different from billing', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      // Uncheck same as billing
      const checkbox = screen.getByLabelText(/shipping address same as billing/i);
      await user.click(checkbox);

      const submitButton = screen.getByRole('button', { name: /continue to shipping/i });
      await user.click(submitButton);

      await waitFor(() => {
        const firstNameErrors = screen.getAllByText('First name is required');
        expect(firstNameErrors).toHaveLength(2); // One for billing, one for shipping
      });
    });

    it('should clear errors when fields are corrected', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      const nameInput = screen.getByLabelText(/full name/i);
      const submitButton = screen.getByRole('button', { name: /continue to shipping/i });
      
      // Trigger validation error
      await user.click(submitButton);
      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
      });

      // Fix the error
      await user.type(nameInput, 'John Doe');
      
      // Error should be cleared
      await waitFor(() => {
        expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should submit form with valid data', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      // Fill in customer info
      await user.type(screen.getByLabelText(/full name/i), 'John Doe');
      await user.type(screen.getByLabelText(/email address/i), 'john@example.com');

      // Fill in billing address
      await user.type(screen.getByLabelText(/first name/i), 'John');
      await user.type(screen.getByLabelText(/last name/i), 'Doe');
      await user.type(screen.getByLabelText(/address line 1/i), '123 Main St');
      await user.type(screen.getByLabelText(/city/i), 'New York');
      await user.selectOptions(screen.getByLabelText(/country/i), 'US');
      await user.type(screen.getByLabelText(/postal code/i), '10001');

      const submitButton = screen.getByRole('button', { name: /continue to shipping/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockCheckout.submitCustomerInfo).toHaveBeenCalledWith({
          customer: {
            name: 'John Doe',
            email: 'john@example.com'
          },
          billingAddress: {
            first_name: 'John',
            last_name: 'Doe',
            line_1: '123 Main St',
            line_2: '',
            city: 'New York',
            county: '',
            country: 'US',
            postcode: '10001'
          },
          sameAsBilling: true
        });
      });
    });

    it('should submit with separate shipping address', async () => {
      const user = userEvent.setup();
      render(<EPCheckoutForm cartId="test-cart-123" />);

      // Fill in customer info
      await user.type(screen.getByLabelText(/full name/i), 'John Doe');
      await user.type(screen.getByLabelText(/email address/i), 'john@example.com');

      // Fill in billing address
      await user.type(screen.getByLabelText(/first name/i), 'John');
      await user.type(screen.getByLabelText(/last name/i), 'Doe');
      await user.type(screen.getByLabelText(/address line 1/i), '123 Main St');
      await user.type(screen.getByLabelText(/city/i), 'New York');
      await user.selectOptions(screen.getByLabelText(/country/i), 'US');
      await user.type(screen.getByLabelText(/postal code/i), '10001');

      // Uncheck same as billing
      const checkbox = screen.getByLabelText(/shipping address same as billing/i);
      await user.click(checkbox);

      // Fill in shipping address
      const shippingInputs = screen.getAllByLabelText(/first name/i);
      await user.type(shippingInputs[1], 'Jane'); // Second first name input is for shipping

      const submitButton = screen.getByRole('button', { name: /continue to shipping/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockCheckout.submitCustomerInfo).toHaveBeenCalledWith(
          expect.objectContaining({
            sameAsBilling: false,
            shippingAddress: expect.objectContaining({
              first_name: 'Jane'
            })
          })
        );
      });
    });
  });

  describe('Loading States', () => {
    it('should disable form when loading', () => {
      mockUseCheckout.mockReturnValue({
        ...mockCheckout,
        state: {
          ...mockCheckout.state,
          isLoading: true
        }
      } as any);

      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByLabelText(/full name/i)).toBeDisabled();
      expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
    });

    it('should show processing text when submitting', () => {
      mockUseCheckout.mockReturnValue({
        ...mockCheckout,
        state: {
          ...mockCheckout.state,
          isLoading: true
        }
      } as any);

      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByRole('button', { name: /processing/i })).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should display checkout errors', () => {
      mockUseCheckout.mockReturnValue({
        ...mockCheckout,
        state: {
          ...mockCheckout.state,
          error: new Error('Network error')
        }
      } as any);

      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  describe('Props Integration', () => {
    it('should pass props to useCheckout hook', () => {
      const onComplete = jest.fn();
      const onError = jest.fn();

      render(
        <EPCheckoutForm
          cartId="test-cart-123"
          apiBaseUrl="/custom-api"
          onComplete={onComplete}
          onError={onError}
        />
      );

      expect(mockUseCheckout).toHaveBeenCalledWith({
        cartId: 'test-cart-123',
        apiBaseUrl: '/custom-api',
        onComplete,
        onError
      });
    });

    it('should apply custom className and style', () => {
      render(
        <EPCheckoutForm
          cartId="test-cart-123"
          className="custom-class"
          style={{ backgroundColor: 'red' }}
        />
      );

      const form = screen.getByRole('form').parentElement;
      expect(form).toHaveClass('custom-class');
      expect(form).toHaveStyle('background-color: red');
    });
  });

  describe('Button States', () => {
    it('should enable submit button when can proceed', () => {
      mockUseCheckout.mockReturnValue({
        ...mockCheckout,
        canProceedToNext: true
      } as any);

      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByRole('button', { name: /continue to shipping/i })).not.toBeDisabled();
    });

    it('should disable submit button when cannot proceed', () => {
      mockUseCheckout.mockReturnValue({
        ...mockCheckout,
        canProceedToNext: false
      } as any);

      render(<EPCheckoutForm cartId="test-cart-123" />);

      expect(screen.getByRole('button', { name: /continue to shipping/i })).toBeDisabled();
    });
  });

  describe('Country Selection', () => {
    it('should include major countries in dropdown', () => {
      render(<EPCheckoutForm cartId="test-cart-123" />);

      const countrySelect = screen.getByLabelText(/country/i);
      
      expect(screen.getByDisplayValue('United States')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Canada')).toBeInTheDocument();
      expect(screen.getByDisplayValue('United Kingdom')).toBeInTheDocument();
    });
  });
});