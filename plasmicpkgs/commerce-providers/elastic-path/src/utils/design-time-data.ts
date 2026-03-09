/**
 * Mock data for design-time preview in the Plasmic editor.
 *
 * All values use "Sample" prefix to be visually distinguishable from real data.
 * Covers the full range of states (in-stock, low-stock, out-of-stock) so
 * designers can style every scenario.
 */

import type {
  Product,
  ProductOption,
  ProductVariant,
} from "@plasmicpkgs/commerce";
import type {
  StockLocationData,
  ProductStockSummary,
} from "../stock/StockContext";

// ---------------------------------------------------------------------------
// Variation mock data
// ---------------------------------------------------------------------------

export const MOCK_VARIATION_OPTIONS: ProductOption[] = [
  {
    __typename: "MultipleChoiceOption",
    id: "sample-color",
    displayName: "Sample Color",
    values: [
      { label: "Midnight Blue", hexColors: ["#191970"] },
      { label: "Forest Green", hexColors: ["#228B22"] },
      { label: "Warm Sand", hexColors: ["#C2B280"] },
    ],
  },
  {
    __typename: "MultipleChoiceOption",
    id: "sample-size",
    displayName: "Sample Size",
    values: [
      { label: "Small" },
      { label: "Medium" },
      { label: "Large" },
    ],
  },
];

function buildMockVariants(): ProductVariant[] {
  const colors = MOCK_VARIATION_OPTIONS[0].values;
  const sizes = MOCK_VARIATION_OPTIONS[1].values;
  const variants: ProductVariant[] = [];
  let idx = 0;

  for (const color of colors) {
    for (const size of sizes) {
      idx++;
      variants.push({
        id: `sample-variant-${idx}`,
        name: `Sample Product – ${color.label} / ${size.label}`,
        price: 49.99,
        availableForSale: true,
        options: [
          {
            id: "sample-color",
            displayName: "Sample Color",
            values: [{ label: color.label, hexColors: color.hexColors }],
          },
          {
            id: "sample-size",
            displayName: "Sample Size",
            values: [{ label: size.label }],
          },
        ],
      });
    }
  }

  return variants;
}

export const MOCK_VARIANTS: ProductVariant[] = buildMockVariants();

export const MOCK_EP_PRODUCT: Product = {
  id: "sample-product-001",
  name: "Sample Variation Product",
  description: "This is sample data for design-time preview",
  slug: "sample-variation-product",
  path: "/sample-variation-product",
  images: [
    {
      url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
      alt: "Sample Product",
    },
  ],
  variants: MOCK_VARIANTS,
  price: { value: 49.99, currencyCode: "USD" },
  options: MOCK_VARIATION_OPTIONS,
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

export interface MockCartItemData {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  quantity: number;
  path: string;
  sku: string;
  price: number;
  listPrice: number;
  formattedPrice: string;
  formattedListPrice: string;
  lineTotal: number;
  formattedLineTotal: string;
  imageUrl: string;
  imageAlt: string;
  options: { name: string; value: string }[];
  hasDiscount: boolean;
  locationSlug: string;
  locationName: string;
  stockAvailable: number | null;
  stockStatus: string;
}

export const MOCK_CART_LINE_ITEMS: MockCartItemData[] = [
  {
    id: "sample-cart-item-1",
    variantId: "sample-variant-1",
    productId: "sample-product-001",
    name: "Sample Lightweight Jacket",
    quantity: 2,
    path: "/sample-lightweight-jacket",
    sku: "SLJ-BLU-M",
    price: 49.99,
    listPrice: 59.99,
    formattedPrice: "$49.99",
    formattedListPrice: "$59.99",
    lineTotal: 99.98,
    formattedLineTotal: "$99.98",
    imageUrl:
      "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    imageAlt: "Sample Lightweight Jacket",
    options: [
      { name: "Color", value: "Midnight Blue" },
      { name: "Size", value: "Medium" },
    ],
    hasDiscount: true,
    locationSlug: "sample-downtown",
    locationName: "Sample Downtown Store",
    stockAvailable: 25,
    stockStatus: "in-stock",
  },
  {
    id: "sample-cart-item-2",
    variantId: "sample-variant-5",
    productId: "sample-product-002",
    name: "Sample Cotton T-Shirt",
    quantity: 1,
    path: "/sample-cotton-tshirt",
    sku: "SCT-WHT-L",
    price: 24.99,
    listPrice: 24.99,
    formattedPrice: "$24.99",
    formattedListPrice: "$24.99",
    lineTotal: 24.99,
    formattedLineTotal: "$24.99",
    imageUrl:
      "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    imageAlt: "Sample Cotton T-Shirt",
    options: [
      { name: "Color", value: "White" },
      { name: "Size", value: "Large" },
    ],
    hasDiscount: false,
    locationSlug: "sample-westside",
    locationName: "Sample Westside Mall",
    stockAvailable: 3,
    stockStatus: "low",
  },
  {
    id: "sample-cart-item-3",
    variantId: "sample-variant-9",
    productId: "sample-product-003",
    name: "Sample Leather Belt",
    quantity: 1,
    path: "/sample-leather-belt",
    sku: "SLB-BRN-32",
    price: 34.99,
    listPrice: 34.99,
    formattedPrice: "$34.99",
    formattedListPrice: "$34.99",
    lineTotal: 34.99,
    formattedLineTotal: "$34.99",
    imageUrl:
      "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    imageAlt: "Sample Leather Belt",
    options: [{ name: "Size", value: "32" }],
    hasDiscount: false,
    locationSlug: "",
    locationName: "",
    stockAvailable: null,
    stockStatus: "",
  },
];

export const MOCK_CART_DATA = {
  id: "sample-cart-001",
  lineItems: MOCK_CART_LINE_ITEMS,
  itemCount: 4,
  isEmpty: false,
  subtotalPrice: 159.96,
  totalPrice: 159.96,
  formattedSubtotal: "$159.96",
  formattedTotal: "$159.96",
  currencyCode: "USD",
};

// ---------------------------------------------------------------------------
// Checkout cart mock data
// ---------------------------------------------------------------------------

export interface MockCheckoutCartItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  formattedPrice: string;
  imageUrl: string;
  sku: string;
  options: { name: string; value: string }[];
}

export const MOCK_CHECKOUT_CART_ITEMS: MockCheckoutCartItem[] = [
  {
    id: "sample-checkout-item-1",
    name: "Fireside Amber Candle",
    quantity: 1,
    price: 38.0,
    formattedPrice: "$38.00",
    imageUrl:
      "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    sku: "EW-FA-001",
    options: [{ name: "Size", value: "8 oz" }],
  },
  {
    id: "sample-checkout-item-2",
    name: "Woodland Sage Candle",
    quantity: 1,
    price: 24.0,
    formattedPrice: "$24.00",
    imageUrl:
      "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
    sku: "EW-WS-001",
    options: [{ name: "Size", value: "4 oz" }],
  },
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
