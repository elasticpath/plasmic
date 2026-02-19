import React, { useState, useCallback } from 'react';
import { useCheckout } from '../hooks/use-checkout';
import type { CheckoutFormData, CustomerData, AddressData, CheckoutStep } from '../types';
import { createLogger } from "../../utils/logger";

const log = createLogger("EPCheckoutForm");

interface EPCheckoutFormProps {
  cartId: string;
  apiBaseUrl?: string;
  onComplete?: (order: any) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: React.CSSProperties;
}

interface FormErrors {
  [key: string]: string;
}

export function EPCheckoutForm({
  cartId,
  apiBaseUrl,
  onComplete,
  onError,
  className,
  style
}: EPCheckoutFormProps) {
  const checkout = useCheckout({
    cartId,
    apiBaseUrl,
    onComplete,
    onError
  });

  const [formData, setFormData] = useState<CheckoutFormData>({
    customer: {
      name: '',
      email: ''
    },
    billingAddress: {
      first_name: '',
      last_name: '',
      line_1: '',
      line_2: '',
      city: '',
      county: '',
      country: '',
      postcode: ''
    },
    sameAsBilling: true
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    // Validate customer info
    if (!formData.customer.name.trim()) {
      newErrors['customer.name'] = 'Name is required';
    }

    if (!formData.customer.email.trim()) {
      newErrors['customer.email'] = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.customer.email)) {
      newErrors['customer.email'] = 'Please enter a valid email address';
    }

    // Validate billing address
    if (!formData.billingAddress.first_name.trim()) {
      newErrors['billingAddress.first_name'] = 'First name is required';
    }

    if (!formData.billingAddress.last_name.trim()) {
      newErrors['billingAddress.last_name'] = 'Last name is required';
    }

    if (!formData.billingAddress.line_1.trim()) {
      newErrors['billingAddress.line_1'] = 'Address line 1 is required';
    }

    if (!formData.billingAddress.city.trim()) {
      newErrors['billingAddress.city'] = 'City is required';
    }

    if (!formData.billingAddress.country.trim()) {
      newErrors['billingAddress.country'] = 'Country is required';
    }

    if (!formData.billingAddress.postcode.trim()) {
      newErrors['billingAddress.postcode'] = 'Postal code is required';
    }

    // Validate shipping address if different from billing
    if (!formData.sameAsBilling && formData.shippingAddress) {
      if (!formData.shippingAddress.first_name?.trim()) {
        newErrors['shippingAddress.first_name'] = 'First name is required';
      }

      if (!formData.shippingAddress.last_name?.trim()) {
        newErrors['shippingAddress.last_name'] = 'Last name is required';
      }

      if (!formData.shippingAddress.line_1?.trim()) {
        newErrors['shippingAddress.line_1'] = 'Address line 1 is required';
      }

      if (!formData.shippingAddress.city?.trim()) {
        newErrors['shippingAddress.city'] = 'City is required';
      }

      if (!formData.shippingAddress.country?.trim()) {
        newErrors['shippingAddress.country'] = 'Country is required';
      }

      if (!formData.shippingAddress.postcode?.trim()) {
        newErrors['shippingAddress.postcode'] = 'Postal code is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleInputChange = useCallback((
    field: string,
    value: string
  ) => {
    setFormData(prev => {
      const keys = field.split('.');
      const newData = { ...prev };
      
      let current: any = newData;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return newData;
    });

    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  }, [errors]);

  const handleSameAsBillingChange = useCallback((checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      sameAsBilling: checked,
      shippingAddress: checked ? undefined : {
        first_name: '',
        last_name: '',
        line_1: '',
        line_2: '',
        city: '',
        county: '',
        country: '',
        postcode: ''
      }
    }));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await checkout.submitCustomerInfo(formData);
    } catch (error) {
      log.error("Form submission error", { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateForm, checkout]);

  const isLoading = checkout.state.isLoading || isSubmitting;

  return (
    <div className={className} style={style}>
      <form onSubmit={handleSubmit}>
        {/* Customer Information Section */}
        <div className="ep-checkout-section">
          <h3>Customer Information</h3>
          
          <div className="ep-form-group">
            <label htmlFor="customer-name">Full Name *</label>
            <input
              id="customer-name"
              type="text"
              value={formData.customer.name}
              onChange={(e) => handleInputChange('customer.name', e.target.value)}
              disabled={isLoading}
              className={errors['customer.name'] ? 'error' : ''}
            />
            {errors['customer.name'] && (
              <span className="error-message">{errors['customer.name']}</span>
            )}
          </div>

          <div className="ep-form-group">
            <label htmlFor="customer-email">Email Address *</label>
            <input
              id="customer-email"
              type="email"
              value={formData.customer.email}
              onChange={(e) => handleInputChange('customer.email', e.target.value)}
              disabled={isLoading}
              className={errors['customer.email'] ? 'error' : ''}
            />
            {errors['customer.email'] && (
              <span className="error-message">{errors['customer.email']}</span>
            )}
          </div>
        </div>

        {/* Billing Address Section */}
        <div className="ep-checkout-section">
          <h3>Billing Address</h3>
          
          <div className="ep-form-row">
            <div className="ep-form-group">
              <label htmlFor="billing-first-name">First Name *</label>
              <input
                id="billing-first-name"
                type="text"
                value={formData.billingAddress.first_name}
                onChange={(e) => handleInputChange('billingAddress.first_name', e.target.value)}
                disabled={isLoading}
                className={errors['billingAddress.first_name'] ? 'error' : ''}
              />
              {errors['billingAddress.first_name'] && (
                <span className="error-message">{errors['billingAddress.first_name']}</span>
              )}
            </div>

            <div className="ep-form-group">
              <label htmlFor="billing-last-name">Last Name *</label>
              <input
                id="billing-last-name"
                type="text"
                value={formData.billingAddress.last_name}
                onChange={(e) => handleInputChange('billingAddress.last_name', e.target.value)}
                disabled={isLoading}
                className={errors['billingAddress.last_name'] ? 'error' : ''}
              />
              {errors['billingAddress.last_name'] && (
                <span className="error-message">{errors['billingAddress.last_name']}</span>
              )}
            </div>
          </div>

          <div className="ep-form-group">
            <label htmlFor="billing-line1">Address Line 1 *</label>
            <input
              id="billing-line1"
              type="text"
              value={formData.billingAddress.line_1}
              onChange={(e) => handleInputChange('billingAddress.line_1', e.target.value)}
              disabled={isLoading}
              className={errors['billingAddress.line_1'] ? 'error' : ''}
            />
            {errors['billingAddress.line_1'] && (
              <span className="error-message">{errors['billingAddress.line_1']}</span>
            )}
          </div>

          <div className="ep-form-group">
            <label htmlFor="billing-line2">Address Line 2</label>
            <input
              id="billing-line2"
              type="text"
              value={formData.billingAddress.line_2 || ''}
              onChange={(e) => handleInputChange('billingAddress.line_2', e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="ep-form-row">
            <div className="ep-form-group">
              <label htmlFor="billing-city">City *</label>
              <input
                id="billing-city"
                type="text"
                value={formData.billingAddress.city}
                onChange={(e) => handleInputChange('billingAddress.city', e.target.value)}
                disabled={isLoading}
                className={errors['billingAddress.city'] ? 'error' : ''}
              />
              {errors['billingAddress.city'] && (
                <span className="error-message">{errors['billingAddress.city']}</span>
              )}
            </div>

            <div className="ep-form-group">
              <label htmlFor="billing-county">State/County</label>
              <input
                id="billing-county"
                type="text"
                value={formData.billingAddress.county || ''}
                onChange={(e) => handleInputChange('billingAddress.county', e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="ep-form-row">
            <div className="ep-form-group">
              <label htmlFor="billing-country">Country *</label>
              <select
                id="billing-country"
                value={formData.billingAddress.country}
                onChange={(e) => handleInputChange('billingAddress.country', e.target.value)}
                disabled={isLoading}
                className={errors['billingAddress.country'] ? 'error' : ''}
              >
                <option value="">Select Country</option>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="GB">United Kingdom</option>
                <option value="AU">Australia</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
                <option value="IT">Italy</option>
                <option value="ES">Spain</option>
                <option value="NL">Netherlands</option>
                <option value="SE">Sweden</option>
                <option value="NO">Norway</option>
                <option value="DK">Denmark</option>
              </select>
              {errors['billingAddress.country'] && (
                <span className="error-message">{errors['billingAddress.country']}</span>
              )}
            </div>

            <div className="ep-form-group">
              <label htmlFor="billing-postcode">Postal Code *</label>
              <input
                id="billing-postcode"
                type="text"
                value={formData.billingAddress.postcode}
                onChange={(e) => handleInputChange('billingAddress.postcode', e.target.value)}
                disabled={isLoading}
                className={errors['billingAddress.postcode'] ? 'error' : ''}
              />
              {errors['billingAddress.postcode'] && (
                <span className="error-message">{errors['billingAddress.postcode']}</span>
              )}
            </div>
          </div>
        </div>

        {/* Shipping Address Toggle */}
        <div className="ep-checkout-section">
          <div className="ep-form-group">
            <label>
              <input
                type="checkbox"
                checked={formData.sameAsBilling}
                onChange={(e) => handleSameAsBillingChange(e.target.checked)}
                disabled={isLoading}
              />
              Shipping address same as billing address
            </label>
          </div>
        </div>

        {/* Shipping Address Section */}
        {!formData.sameAsBilling && (
          <div className="ep-checkout-section">
            <h3>Shipping Address</h3>
            
            <div className="ep-form-row">
              <div className="ep-form-group">
                <label htmlFor="shipping-first-name">First Name *</label>
                <input
                  id="shipping-first-name"
                  type="text"
                  value={formData.shippingAddress?.first_name || ''}
                  onChange={(e) => handleInputChange('shippingAddress.first_name', e.target.value)}
                  disabled={isLoading}
                  className={errors['shippingAddress.first_name'] ? 'error' : ''}
                />
                {errors['shippingAddress.first_name'] && (
                  <span className="error-message">{errors['shippingAddress.first_name']}</span>
                )}
              </div>

              <div className="ep-form-group">
                <label htmlFor="shipping-last-name">Last Name *</label>
                <input
                  id="shipping-last-name"
                  type="text"
                  value={formData.shippingAddress?.last_name || ''}
                  onChange={(e) => handleInputChange('shippingAddress.last_name', e.target.value)}
                  disabled={isLoading}
                  className={errors['shippingAddress.last_name'] ? 'error' : ''}
                />
                {errors['shippingAddress.last_name'] && (
                  <span className="error-message">{errors['shippingAddress.last_name']}</span>
                )}
              </div>
            </div>

            <div className="ep-form-group">
              <label htmlFor="shipping-line1">Address Line 1 *</label>
              <input
                id="shipping-line1"
                type="text"
                value={formData.shippingAddress?.line_1 || ''}
                onChange={(e) => handleInputChange('shippingAddress.line_1', e.target.value)}
                disabled={isLoading}
                className={errors['shippingAddress.line_1'] ? 'error' : ''}
              />
              {errors['shippingAddress.line_1'] && (
                <span className="error-message">{errors['shippingAddress.line_1']}</span>
              )}
            </div>

            <div className="ep-form-group">
              <label htmlFor="shipping-line2">Address Line 2</label>
              <input
                id="shipping-line2"
                type="text"
                value={formData.shippingAddress?.line_2 || ''}
                onChange={(e) => handleInputChange('shippingAddress.line_2', e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="ep-form-row">
              <div className="ep-form-group">
                <label htmlFor="shipping-city">City *</label>
                <input
                  id="shipping-city"
                  type="text"
                  value={formData.shippingAddress?.city || ''}
                  onChange={(e) => handleInputChange('shippingAddress.city', e.target.value)}
                  disabled={isLoading}
                  className={errors['shippingAddress.city'] ? 'error' : ''}
                />
                {errors['shippingAddress.city'] && (
                  <span className="error-message">{errors['shippingAddress.city']}</span>
                )}
              </div>

              <div className="ep-form-group">
                <label htmlFor="shipping-county">State/County</label>
                <input
                  id="shipping-county"
                  type="text"
                  value={formData.shippingAddress?.county || ''}
                  onChange={(e) => handleInputChange('shippingAddress.county', e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="ep-form-row">
              <div className="ep-form-group">
                <label htmlFor="shipping-country">Country *</label>
                <select
                  id="shipping-country"
                  value={formData.shippingAddress?.country || ''}
                  onChange={(e) => handleInputChange('shippingAddress.country', e.target.value)}
                  disabled={isLoading}
                  className={errors['shippingAddress.country'] ? 'error' : ''}
                >
                  <option value="">Select Country</option>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="DE">Germany</option>
                  <option value="FR">France</option>
                  <option value="IT">Italy</option>
                  <option value="ES">Spain</option>
                  <option value="NL">Netherlands</option>
                  <option value="SE">Sweden</option>
                  <option value="NO">Norway</option>
                  <option value="DK">Denmark</option>
                </select>
                {errors['shippingAddress.country'] && (
                  <span className="error-message">{errors['shippingAddress.country']}</span>
                )}
              </div>

              <div className="ep-form-group">
                <label htmlFor="shipping-postcode">Postal Code *</label>
                <input
                  id="shipping-postcode"
                  type="text"
                  value={formData.shippingAddress?.postcode || ''}
                  onChange={(e) => handleInputChange('shippingAddress.postcode', e.target.value)}
                  disabled={isLoading}
                  className={errors['shippingAddress.postcode'] ? 'error' : ''}
                />
                {errors['shippingAddress.postcode'] && (
                  <span className="error-message">{errors['shippingAddress.postcode']}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {checkout.state.error && (
          <div className="ep-error-message">
            {checkout.state.error.message}
          </div>
        )}

        {/* Submit Button */}
        <div className="ep-checkout-actions">
          <button
            type="submit"
            disabled={isLoading || !checkout.canProceedToNext}
            className="ep-submit-button"
          >
            {isLoading ? 'Processing...' : 'Continue to Shipping'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EPCheckoutForm;