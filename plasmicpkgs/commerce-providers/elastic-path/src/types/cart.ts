export type SelectedOption = {
  id?: string;
  name: string;
  value: string;
};

export type CartItemBody = {
  variantId: string;
  productId?: string;
  quantity?: number;
};

/** The subset of variant data a cart line carries; see normalizeLineItem. */
export type CartLineVariant = {
  id: string;
  name: string;
  sku: string;
  price: number;
  listPrice: number;
  requiresShipping: boolean;
  image?: { url: string; alt?: string };
};

export type LineItem = {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  quantity: number;
  /** Human-friendly path derived from the product id. */
  path: string;
  variant: CartLineVariant;
  options?: SelectedOption[];
};

export type Cart = {
  id: string;
  customerId?: string;
  email?: string;
  createdAt: string;
  currency: { code: string };
  taxesIncluded: boolean;
  lineItems: LineItem[];
  /** Sum of all item prices, excluding duties, taxes, shipping and discounts. */
  lineItemsSubtotalPrice: number;
  subtotalPrice: number;
  totalPrice: number;
  url?: string;
};
