import type { BundleConfiguration } from "@epcc-sdk/sdks-shopper";
import type { CartItemBody } from "../../types/cart";

/**
 * Extended cart item interface including EP-specific features
 * Extends core CartItemBody with EP-specific functionality
 */
export interface ExtendedCartItem extends CartItemBody {
  // Core fields from CartItemBody (variantId: string, productId?: string, quantity?: number)
  bundleConfiguration?: BundleConfiguration; // EP-specific bundle configuration
  locationId?: string; // EP-specific location
}

/**
 * Form values from React Hook Form context
 */
export interface CartFormValues {
  ProductQuantity?: number;
  ProductVariant?: string;
  BundleConfiguration?: BundleConfiguration;
  SelectedLocationSlug?: string;
}

/**
 * Props for add to cart button component
 */
export interface AddToCartButtonProps {
  locationId?: string;
  locationSlug?: string;
}

/**
 * Cart item data structure for EP API
 */
export interface CartItemData {
  type: "cart_item";
  id: string;
  quantity: number;
  bundle_configuration?: BundleConfiguration;
  location?: string;
}

/**
 * Resolves the target location slug from form values and props
 * @param formValues Current form values
 * @param props Component props
 * @returns Location slug to use, or undefined
 */
export function resolveLocationSlug(
  formValues: CartFormValues,
  props: AddToCartButtonProps
): string | undefined {
  // Priority: form context > prop slug > prop ID (as fallback)
  return formValues.SelectedLocationSlug || props.locationSlug || props.locationId;
}

/**
 * Extracts cart item details from form values and product info
 * @param formValues Form values from React Hook Form
 * @param product Product object
 * @param props Component props
 * @returns Extended cart item object
 */
export function extractCartItemFromForm(
  formValues: CartFormValues,
  product: any,
  props: AddToCartButtonProps
): ExtendedCartItem {
  if (!product?.id) {
    throw new Error("Product ID is required for cart item");
  }

  // For EP: variantId is required by core, use first variant or product ID as fallback
  const variantId = formValues.ProductVariant ?? product?.variants?.[0]?.id ?? product.id;
  const quantity = formValues.ProductQuantity ?? 1;
  const bundleConfiguration = formValues.BundleConfiguration;
  const locationId = resolveLocationSlug(formValues, props);

  return {
    variantId,            // Required by core
    productId: product.id, // Optional in core but we provide it for EP
    quantity: Math.max(1, quantity), // Optional in core but we provide it for EP
    ...(bundleConfiguration && { bundleConfiguration }),
    ...(locationId && { locationId }),
  };
}

/**
 * Builds cart item data for EP API from cart item
 * @param item Extended cart item
 * @returns Cart item data for API call
 */
export function buildCartItemData(item: ExtendedCartItem): CartItemData {
  // Use variantId (which is required) or productId as fallback
  const cartItemId = item.variantId || item.productId || "";

  const cartData: CartItemData = {
    type: "cart_item",
    id: cartItemId,
    quantity: item.quantity || 1, // Use provided quantity or default to 1
  };

  // Add bundle configuration if provided
  if (item.bundleConfiguration) {
    cartData.bundle_configuration = item.bundleConfiguration;
  }

  // Add location if provided
  if (item.locationId) {
    cartData.location = item.locationId;
  }

  return cartData;
}

/**
 * Validates cart item before adding to cart
 * @param item Cart item to validate
 * @returns Validation result
 */
export function validateCartItem(item: ExtendedCartItem): {
  isValid: boolean;
  errorMessage?: string;
} {
  // variantId is required by core
  if (!item.variantId || typeof item.variantId !== 'string' || item.variantId.trim() === '') {
    return {
      isValid: false,
      errorMessage: "Variant ID is required and must be a non-empty string",
    };
  }

  // For EP, we want to ensure we have productId for our internal logic
  if (!item.productId || typeof item.productId !== 'string' || item.productId.trim() === '') {
    return {
      isValid: false,
      errorMessage: "Product ID is required for Elastic Path items",
    };
  }

  // For EP, we want to ensure we have quantity
  if (item.quantity === undefined || item.quantity === null || item.quantity < 1) {
    return {
      isValid: false,
      errorMessage: "Quantity must be at least 1",
    };
  }

  if (!Number.isInteger(item.quantity)) {
    return {
      isValid: false,
      errorMessage: "Quantity must be a whole number",
    };
  }

  return { isValid: true };
}

/**
 * Validates quantity from form input
 * @param quantityValue Raw quantity value from form
 * @returns Validation result with parsed quantity
 */
export function validateAndParseQuantity(quantityValue: any): {
  isValid: boolean;
  quantity: number;
  errorMessage?: string;
} {
  const quantity = Number(quantityValue);

  if (isNaN(quantity)) {
    return {
      isValid: false,
      quantity: 0,
      errorMessage: "The item quantity has to be a valid number",
    };
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return {
      isValid: false,
      quantity,
      errorMessage: "The item quantity has to be a valid integer greater than 0",
    };
  }

  return {
    isValid: true,
    quantity,
  };
}

/**
 * Determines the cart item ID to use (variant or product)
 * @param productId Product ID
 * @param variantId Optional variant ID
 * @returns ID to use for cart item
 */
export function getCartItemId(productId: string, variantId?: string): string {
  return variantId || productId;
}

/**
 * Converts ExtendedCartItem to core CartItemBody format
 * Handles the paradigm difference between EP (product-centric) and core (variant-centric)
 * @param item Extended cart item
 * @returns Cart item body compatible with core commerce types
 */
export function toCartItemBody(item: ExtendedCartItem): CartItemBody {
  // Core commerce expects variantId as required field
  // ExtendedCartItem already extends CartItemBody so this is mostly a pass-through
  return {
    variantId: item.variantId,
    productId: item.productId,
    quantity: item.quantity,
  };
}

/**
 * Creates a debug-friendly representation of cart item data
 * @param item Extended cart item
 * @param cartData Built cart data
 * @returns Debug info object
 */
export function createCartDebugInfo(
  item: ExtendedCartItem,
  cartData: CartItemData
): Record<string, any> {
  return {
    originalItem: item,
    builtCartData: cartData,
    hasBundle: !!item.bundleConfiguration,
    hasLocation: !!item.locationId,
    cartItemId: cartData.id,
    timestamp: new Date().toISOString(),
  };
}