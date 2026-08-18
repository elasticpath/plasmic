/**
 * Mock data for design-time preview in the Plasmic editor.
 *
 * All values use "Sample" prefix to be visually distinguishable from real data.
 * Covers the full range of states (in-stock, low-stock, out-of-stock) so
 * designers can style every scenario.
 */

import type { Cart, CartItem, SelectedOption } from "../types/cart";
import type {
  ChildProduct,
  Product,
  ProductImage,
  Variation,
} from "../types/product";
import type {
  StockLocationData,
  ProductStockSummary,
} from "../stock/StockContext";

// ---------------------------------------------------------------------------
// Variation mock data
// ---------------------------------------------------------------------------

/**
 * Builds a design-time product in Elastic Path's own shape, so mocks and real
 * responses bind identically in canvas.
 */
export function mockProduct(spec: {
  id: string;
  name: string;
  slug?: string;
  sku?: string;
  description?: string;
  /** Minor units, as Elastic Path reports them. */
  amount?: number;
  currency?: string;
  formatted?: string;
  images?: ProductImage[];
  variations?: Variation[];
  childProducts?: ChildProduct[];
}): Product {
  const currency = spec.currency ?? "USD";
  const amount = spec.amount ?? 0;
  return {
    id: spec.id,
    type: "product",
    attributes: {
      name: spec.name,
      slug: spec.slug,
      sku: spec.sku,
      description: spec.description,
    },
    meta: {
      display_price: {
        without_tax: {
          amount,
          currency,
          float_price: amount / 100,
          formatted: spec.formatted ?? `$${(amount / 100).toFixed(2)}`,
        },
      },
    },
    images: spec.images ?? [],
    variations: spec.variations ?? [],
    childProducts: spec.childProducts ?? [],
  };
}

export const MOCK_VARIATIONS: Variation[] = [
  {
    id: "sample-color",
    name: "Sample Color",
    options: [
      { id: "sample-color-midnight", name: "Midnight Blue" },
      { id: "sample-color-forest", name: "Forest Green" },
      { id: "sample-color-sand", name: "Warm Sand" },
    ],
  },
  {
    id: "sample-size",
    name: "Sample Size",
    options: [
      { id: "sample-size-s", name: "Small" },
      { id: "sample-size-m", name: "Medium" },
      { id: "sample-size-l", name: "Large" },
    ],
  },
];

function buildMockChildProducts(): ChildProduct[] {
  const [colors, sizes] = [MOCK_VARIATIONS[0].options, MOCK_VARIATIONS[1].options];
  const children: ChildProduct[] = [];
  let idx = 0;

  for (const color of colors) {
    for (const size of sizes) {
      idx++;
      children.push({
        id: `sample-child-${idx}`,
        name: `Sample Product – ${color.name} / ${size.name}`,
        sku: `SAMPLE-${idx}`,
        price: {
          amount: 4999,
          currency: "USD",
          formatted: "$49.99",
          float_price: 49.99,
        },
        optionIds: [color.id, size.id],
        images: [],
      });
    }
  }

  return children;
}

export const MOCK_CHILD_PRODUCTS: ChildProduct[] = buildMockChildProducts();

export const MOCK_EP_PRODUCT: Product = {
  id: "sample-product-001",
  type: "product",
  attributes: {
    name: "Sample Variation Product",
    description: "This is sample data for design-time preview",
    slug: "sample-variation-product",
    sku: "SAMPLE-PARENT",
  },
  meta: {
    display_price: {
      without_tax: {
        amount: 4999,
        currency: "USD",
        formatted: "$49.99",
        float_price: 49.99,
      },
    },
  },
  images: [
    {
      url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
      alt: "Sample Product",
    },
  ],
  variations: MOCK_VARIATIONS,
  childProducts: MOCK_CHILD_PRODUCTS,
};

// ---------------------------------------------------------------------------
// Stock / location mock data
// ---------------------------------------------------------------------------

export const MOCK_STOCK_LOCATIONS: StockLocationData[] = [
  {
    name: "Sample Downtown Store",
    slug: "sample-downtown",
    available: 25,
    allocated: 3,
    total: 28,
    isInStock: true,
    isLowStock: false,
    stockStatus: "in-stock",
  },
  {
    name: "Sample Westside Mall",
    slug: "sample-westside",
    available: 3,
    allocated: 1,
    total: 4,
    isInStock: true,
    isLowStock: true,
    stockStatus: "low",
  },
  {
    name: "Sample Airport Outlet",
    slug: "sample-airport",
    available: 0,
    allocated: 0,
    total: 0,
    isInStock: false,
    isLowStock: false,
    stockStatus: "out-of-stock",
  },
];

export const MOCK_PRODUCT_STOCK: ProductStockSummary = {
  totalAvailable: 28,
  totalAllocated: 4,
  locationCount: 3,
  isInStock: true,
  isLowStock: false,
};

// ---------------------------------------------------------------------------
// Cart mock data
// ---------------------------------------------------------------------------

/** Builds a design-time cart line in Elastic Path's own shape. */
export function mockCartItem(spec: {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  /** Unit price in minor units. */
  amount: number;
  currency?: string;
  imageUrl?: string;
  options?: SelectedOption[];
  location?: string;
  /** Pre-discount unit price in minor units, when the line is discounted. */
  listAmount?: number;
  locationName?: string;
  stockAvailable?: number | null;
  stockStatus?: string;
}): CartItem {
  const currency = spec.currency ?? "USD";
  const money = (minor: number) => ({
    amount: minor,
    currency,
    float_price: minor / 100,
    formatted: `$${(minor / 100).toFixed(2)}`,
  });
  return {
    id: spec.id,
    type: "cart_item",
    product_id: spec.productId,
    name: spec.name,
    sku: spec.sku,
    quantity: spec.quantity,
    ...(spec.imageUrl && { image: { href: spec.imageUrl } }),
    ...(spec.location && { location: spec.location }),
    ...(spec.options?.length && {
      custom_inputs: { _selectedOptions: spec.options },
    }),
    meta: {
      display_price: {
        without_tax: {
          unit: money(spec.amount),
          value: money(spec.amount * spec.quantity),
        },
        ...(spec.listAmount && {
          without_discount: {
            unit: money(spec.listAmount),
            value: money(spec.listAmount * spec.quantity),
          },
        }),
      },
    },
    // The design-time line stands in for an enriched one, so the cart-item
    // field components resolve every choice in canvas.
    options: spec.options ?? [],
    locationName: spec.locationName ?? "",
    stockAvailable: spec.stockAvailable ?? null,
    stockStatus: spec.stockStatus ?? "",
  } as unknown as CartItem;
}

export const MOCK_CART_LINE_ITEMS: CartItem[] = [
  mockCartItem({
    id: "sample-cart-item-1",
    productId: "sample-product-001",
    name: "Sample Lightweight Jacket",
    sku: "SLJ-BLU-M",
    quantity: 2,
    amount: 4999,
    listAmount: 5999,
    imageUrl: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    options: [
      { name: "Color", value: "Midnight Blue" },
      { name: "Size", value: "Medium" },
    ],
    location: "sample-downtown",
    locationName: "Sample Downtown Store",
    stockAvailable: 25,
    stockStatus: "in-stock",
  }),
  mockCartItem({
    id: "sample-cart-item-2",
    productId: "sample-product-002",
    name: "Sample Cotton T-Shirt",
    sku: "SCT-WHT-L",
    quantity: 1,
    amount: 2499,
    imageUrl: "https://static1.plasmic.app/commerce/cotton-tshirt-0.png",
    options: [{ name: "Size", value: "Large" }],
  }),
];

const mockCartMoney = (minor: number) => ({
  amount: minor,
  currency: "USD",
  float_price: minor / 100,
  formatted: `$${(minor / 100).toFixed(2)}`,
});

export const MOCK_CART_DATA: Cart = {
  id: "sample-cart-001",
  type: "cart",
  items: MOCK_CART_LINE_ITEMS,
  itemCount: 3,
  meta: {
    display_price: {
      without_tax: mockCartMoney(12497),
      tax: mockCartMoney(2499),
      with_tax: mockCartMoney(14996),
    },
  },
};

/** Empty-cart variant of {@link MOCK_CART_DATA} for the design-time "empty" preview. */
export const MOCK_EMPTY_CART_DATA: Cart = {
  ...MOCK_CART_DATA,
  items: [],
  itemCount: 0,
  meta: {
    display_price: {
      without_tax: mockCartMoney(0),
      tax: mockCartMoney(0),
      with_tax: mockCartMoney(0),
    },
  },
};

// ---------------------------------------------------------------------------
// Checkout cart mock data
// ---------------------------------------------------------------------------

export const MOCK_CHECKOUT_CART_ITEMS: CartItem[] = [
  mockCartItem({
    id: "sample-checkout-item-1",
    productId: "sample-checkout-product-1",
    name: "Fireside Amber Candle",
    sku: "EW-FA-001",
    quantity: 1,
    amount: 3800,
    imageUrl: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    options: [{ name: "Size", value: "8 oz" }],
  }),
  mockCartItem({
    id: "sample-checkout-item-2",
    productId: "sample-checkout-product-2",
    name: "Woodland Sage Candle",
    sku: "EW-WS-001",
    quantity: 1,
    amount: 2400,
    imageUrl: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    options: [{ name: "Size", value: "4 oz" }],
  }),
];

export const MOCK_CHECKOUT_CART_DATA = {
  id: "sample-checkout-cart-001",
  items: MOCK_CHECKOUT_CART_ITEMS,
  itemCount: 2,
  subtotal: 62.0,
  tax: 4.96,
  shipping: 5.95,
  total: 72.91,
  formattedSubtotal: "$62.00",
  formattedTax: "$4.96",
  formattedShipping: "$5.95",
  formattedTotal: "$72.91",
  currencyCode: "USD",
  hasPromo: false,
  promoCode: null as string | null,
  promoDiscount: 0,
  formattedPromoDiscount: null as string | null,
};

// ---------------------------------------------------------------------------
// Composable checkout mock data — used by EPCheckoutProvider and child
// components for design-time preview in Plasmic Studio. Values in minor
// units (cents) match the EP API convention.
// ---------------------------------------------------------------------------

/** Shared summary shape used across all checkout preview states. */
const MOCK_CHECKOUT_SUMMARY = {
  subtotal: 6200,
  subtotalFormatted: "$62.00",
  tax: 496,
  taxFormatted: "$4.96",
  shipping: 0,
  shippingFormatted: "$0.00",
  discount: 0,
  discountFormatted: "$0.00",
  total: 6696,
  totalFormatted: "$66.96",
  currency: "USD",
  itemCount: 2,
};

/** Customer Info step — form is empty, nothing submitted yet. */
export const MOCK_CHECKOUT_DATA_CUSTOMER_INFO = {
  step: "customer_info" as const,
  stepIndex: 0,
  totalSteps: 4,
  canProceed: false,
  isProcessing: false,
  customerInfo: null,
  shippingAddress: null,
  billingAddress: null,
  sameAsShipping: true,
  selectedShippingRate: null,
  order: null,
  paymentStatus: "idle" as const,
  error: null,
  summary: MOCK_CHECKOUT_SUMMARY,
};

/** Shipping step — customer info filled, choosing shipping. */
export const MOCK_CHECKOUT_DATA_SHIPPING = {
  ...MOCK_CHECKOUT_DATA_CUSTOMER_INFO,
  step: "shipping" as const,
  stepIndex: 1,
  canProceed: false,
  customerInfo: {
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@example.com",
  },
  shippingAddress: {
    first_name: "Jane",
    last_name: "Smith",
    line_1: "123 Main St",
    city: "Portland",
    county: "OR",
    postcode: "97201",
    country: "US",
  },
  billingAddress: {
    first_name: "Jane",
    last_name: "Smith",
    line_1: "123 Main St",
    city: "Portland",
    county: "OR",
    postcode: "97201",
    country: "US",
  },
};

/** Payment step — shipping selected, ready for payment. */
export const MOCK_CHECKOUT_DATA_PAYMENT = {
  ...MOCK_CHECKOUT_DATA_SHIPPING,
  step: "payment" as const,
  stepIndex: 2,
  canProceed: true,
  selectedShippingRate: {
    id: "std",
    name: "Standard Shipping",
    price: 595,
    priceFormatted: "$5.95",
    currency: "USD",
    estimatedDays: "3-5 business days",
    carrier: "USPS",
  },
  summary: {
    ...MOCK_CHECKOUT_SUMMARY,
    shipping: 595,
    shippingFormatted: "$5.95",
    total: 7291,
    totalFormatted: "$72.91",
  },
};

/** Confirmation step — order placed and paid. */
export const MOCK_CHECKOUT_DATA_CONFIRMATION = {
  ...MOCK_CHECKOUT_DATA_PAYMENT,
  step: "confirmation" as const,
  stepIndex: 3,
  canProceed: false,
  paymentStatus: "succeeded" as const,
  order: {
    id: "sample-order-001",
    type: "order" as const,
    status: "complete",
    payment: "paid",
    total: { amount: 7291, currency: "USD" },
    subtotal: { amount: 6200, currency: "USD" },
    tax: { amount: 496, currency: "USD" },
    shipping: { amount: 595, currency: "USD" },
    customer: { name: "Jane Smith", email: "jane@example.com" },
    billing_address: {
      first_name: "Jane",
      last_name: "Smith",
      line_1: "123 Main St",
      city: "Portland",
      county: "OR",
      postcode: "97201",
      country: "US",
    },
    shipping_address: {
      first_name: "Jane",
      last_name: "Smith",
      line_1: "123 Main St",
      city: "Portland",
      county: "OR",
      postcode: "97201",
      country: "US",
    },
    relationships: { items: { data: [] } },
  },
};

/** Step indicator mock — Shipping active (index 1). */
export const MOCK_CHECKOUT_STEP_DATA = [
  {
    name: "Customer Info",
    stepKey: "customer_info",
    index: 0,
    isActive: false,
    isCompleted: true,
    isFuture: false,
  },
  {
    name: "Shipping",
    stepKey: "shipping",
    index: 1,
    isActive: true,
    isCompleted: false,
    isFuture: false,
  },
  {
    name: "Payment",
    stepKey: "payment",
    index: 2,
    isActive: false,
    isCompleted: false,
    isFuture: true,
  },
  {
    name: "Confirmation",
    stepKey: "confirmation",
    index: 3,
    isActive: false,
    isCompleted: false,
    isFuture: true,
  },
];

/** Order totals breakdown mock. */
export const MOCK_ORDER_TOTALS_DATA = {
  subtotal: 6200,
  subtotalFormatted: "$62.00",
  tax: 496,
  taxFormatted: "$4.96",
  shipping: 595,
  shippingFormatted: "$5.95",
  discount: 0,
  discountFormatted: "$0.00",
  hasDiscount: false,
  total: 7291,
  totalFormatted: "$72.91",
  currency: "USD",
  itemCount: 2,
};

/** Empty customer info fields mock. */
export const MOCK_CUSTOMER_INFO_EMPTY = {
  firstName: "",
  lastName: "",
  email: "",
  errors: { firstName: null as string | null, lastName: null as string | null, email: null as string | null },
  touched: { firstName: false, lastName: false, email: false },
  isValid: false,
  isDirty: false,
};

/** Filled customer info fields mock. */
export const MOCK_CUSTOMER_INFO_FILLED = {
  firstName: "Jane",
  lastName: "Smith",
  email: "jane@example.com",
  errors: { firstName: null as string | null, lastName: null as string | null, email: null as string | null },
  touched: { firstName: true, lastName: true, email: true },
  isValid: true,
  isDirty: false,
};

/** Customer info fields mock with validation errors. */
export const MOCK_CUSTOMER_INFO_WITH_ERRORS = {
  firstName: "",
  lastName: "Smith",
  email: "not-an-email",
  errors: {
    firstName: "First name is required" as string | null,
    lastName: null as string | null,
    email: "Enter a valid email address" as string | null,
  },
  touched: { firstName: true, lastName: true, email: true },
  isValid: false,
  isDirty: true,
};

/** Empty shipping address fields mock. */
export const MOCK_SHIPPING_ADDRESS_EMPTY = {
  firstName: "",
  lastName: "",
  line1: "",
  line2: "",
  city: "",
  county: "",
  postcode: "",
  country: "",
  phone: "",
  errors: {
    firstName: null as string | null,
    lastName: null as string | null,
    line1: null as string | null,
    city: null as string | null,
    postcode: null as string | null,
    country: null as string | null,
    phone: null as string | null,
  },
  touched: {
    firstName: false,
    lastName: false,
    line1: false,
    city: false,
    postcode: false,
    country: false,
    phone: false,
  },
  isValid: false,
  isDirty: false,
  suggestions: null as Array<{ line1: string; city: string; county: string; postcode: string; country: string }> | null,
  hasSuggestions: false,
};

/** Filled shipping address fields mock. */
export const MOCK_SHIPPING_ADDRESS_FILLED = {
  firstName: "Jane",
  lastName: "Smith",
  line1: "123 Main St",
  line2: "",
  city: "Portland",
  county: "OR",
  postcode: "97201",
  country: "US",
  phone: "555-0100",
  errors: {
    firstName: null,
    lastName: null,
    line1: null,
    city: null,
    postcode: null,
    country: null,
    phone: null,
  },
  touched: {
    firstName: true,
    lastName: true,
    line1: true,
    city: true,
    postcode: true,
    country: true,
    phone: true,
  },
  isValid: true,
  isDirty: false,
  suggestions: null,
  hasSuggestions: false,
};

/** Shipping address fields mock with validation errors. */
export const MOCK_SHIPPING_ADDRESS_WITH_ERRORS = {
  firstName: "Jane",
  lastName: "Smith",
  line1: "",
  line2: "",
  city: "Portland",
  county: "OR",
  postcode: "INVALID",
  country: "US",
  phone: "",
  errors: {
    firstName: null as string | null,
    lastName: null as string | null,
    line1: "Street address is required" as string | null,
    city: null as string | null,
    postcode: "Enter a valid ZIP code" as string | null,
    country: null as string | null,
    phone: null as string | null,
  },
  touched: {
    firstName: true,
    lastName: true,
    line1: true,
    city: true,
    postcode: true,
    country: true,
    phone: true,
  },
  isValid: false,
  isDirty: true,
  suggestions: null as Array<{ line1: string; city: string; county: string; postcode: string; country: string }> | null,
  hasSuggestions: false,
};

/** Shipping address fields mock with address suggestions. */
export const MOCK_SHIPPING_ADDRESS_WITH_SUGGESTIONS = {
  ...MOCK_SHIPPING_ADDRESS_FILLED,
  suggestions: [
    {
      line1: "123 Main Street",
      city: "Portland",
      county: "OR",
      postcode: "97201-3456",
      country: "US",
    },
  ],
  hasSuggestions: true,
};

/** Billing address fields mock (different from shipping). */
export const MOCK_BILLING_ADDRESS_DIFFERENT = {
  firstName: "Jane",
  lastName: "Smith",
  line1: "456 Oak Ave",
  line2: "Suite 200",
  city: "Seattle",
  county: "WA",
  postcode: "98101",
  country: "US",
  errors: {
    firstName: null as string | null,
    lastName: null as string | null,
    line1: null as string | null,
    city: null as string | null,
    postcode: null as string | null,
    country: null as string | null,
  },
  touched: {
    firstName: true,
    lastName: true,
    line1: true,
    city: true,
    postcode: true,
    country: true,
  },
  isValid: true,
  isDirty: true,
  isMirroringShipping: false,
};

/** Sample shipping rates for EPShippingMethodSelector preview. */
export const MOCK_SHIPPING_RATES = [
  {
    id: "free",
    name: "Free Shipping",
    price: 0,
    priceFormatted: "FREE",
    estimatedDays: "5-7 business days",
    carrier: "",
    isSelected: true,
  },
  {
    id: "std",
    name: "Standard Shipping",
    price: 595,
    priceFormatted: "$5.95",
    estimatedDays: "3-5 business days",
    carrier: "USPS",
    isSelected: false,
  },
  {
    id: "exp",
    name: "Express Shipping",
    price: 1295,
    priceFormatted: "$12.95",
    estimatedDays: "1-2 business days",
    carrier: "UPS",
    isSelected: false,
  },
];
