/**
 * Mock data for product discovery design-time preview in Plasmic Studio.
 *
 * All values use "Sample" prefix to be visually distinguishable from real data.
 * Covers pagination metadata so designers can bind to every exposed field.
 */

import type { Product } from "../types/product";

// ---------------------------------------------------------------------------
// Product mock data — 6 sample products
// ---------------------------------------------------------------------------

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "sample-pd-001",
    name: "Sample Leather Weekender Bag",
    slug: "sample-leather-weekender-bag",
    path: "/sample-leather-weekender-bag",
    description: "A hand-crafted full-grain leather weekender bag with brass hardware.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Leather Weekender Bag",
      },
    ],
    variants: [
      { id: "sample-pd-001", name: "Sample Leather Weekender Bag", price: 189.99, options: [] },
    ],
    price: { value: 189.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-pd-002",
    name: "Sample Merino Wool Scarf",
    slug: "sample-merino-wool-scarf",
    path: "/sample-merino-wool-scarf",
    description: "Ultra-soft merino wool scarf in a classic herringbone weave.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Merino Wool Scarf",
      },
    ],
    variants: [
      { id: "sample-pd-002", name: "Sample Merino Wool Scarf", price: 64.99, options: [] },
    ],
    price: { value: 64.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-pd-003",
    name: "Sample Canvas Backpack",
    slug: "sample-canvas-backpack",
    path: "/sample-canvas-backpack",
    description: "Waxed canvas backpack with padded laptop compartment and leather straps.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Canvas Backpack",
      },
    ],
    variants: [
      { id: "sample-pd-003", name: "Sample Canvas Backpack", price: 129.0, options: [] },
    ],
    price: { value: 129.0, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-pd-004",
    name: "Sample Silk Pocket Square",
    slug: "sample-silk-pocket-square",
    path: "/sample-silk-pocket-square",
    description: "Hand-rolled Italian silk pocket square with geometric print.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Silk Pocket Square",
      },
    ],
    variants: [
      { id: "sample-pd-004", name: "Sample Silk Pocket Square", price: 39.99, options: [] },
    ],
    price: { value: 39.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-pd-005",
    name: "Sample Suede Chelsea Boots",
    slug: "sample-suede-chelsea-boots",
    path: "/sample-suede-chelsea-boots",
    description: "Italian suede Chelsea boots with Goodyear welt construction.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Suede Chelsea Boots",
      },
    ],
    variants: [
      { id: "sample-pd-005", name: "Sample Suede Chelsea Boots", price: 249.0, options: [] },
    ],
    price: { value: 249.0, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-pd-006",
    name: "Sample Linen Dress Shirt",
    slug: "sample-linen-dress-shirt",
    path: "/sample-linen-dress-shirt",
    description: "Breathable linen dress shirt with mother-of-pearl buttons.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Linen Dress Shirt",
      },
    ],
    variants: [
      { id: "sample-pd-006", name: "Sample Linen Dress Shirt", price: 89.99, options: [] },
    ],
    price: { value: 89.99, currencyCode: "USD" },
    options: [],
  },
];

// ---------------------------------------------------------------------------
// ProductGridData mock — the shape exposed via DataProvider
// ---------------------------------------------------------------------------

export interface ProductGridData {
  products: Product[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  sort: string;
  isLoading: boolean;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isEmpty: boolean;
  rangeStart: number;
  rangeEnd: number;
  summary: string;
}

export const MOCK_PRODUCT_GRID_DATA: ProductGridData = {
  products: MOCK_PRODUCTS,
  totalCount: 48,
  currentPage: 0,
  totalPages: 4,
  pageSize: 12,
  sort: "",
  isLoading: false,
  hasNextPage: true,
  hasPreviousPage: false,
  isEmpty: false,
  rangeStart: 1,
  rangeEnd: 6,
  summary: "Showing 1-6 of 48 products",
};

// ---------------------------------------------------------------------------
// Related products mock data — 4 distinct products for Phase 3
// ---------------------------------------------------------------------------

export const MOCK_RELATED_PRODUCTS: Product[] = [
  {
    id: "sample-rp-001",
    name: "Sample Leather Belt",
    slug: "sample-leather-belt",
    path: "/sample-leather-belt",
    description: "Full-grain leather belt with brushed nickel buckle.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Leather Belt",
      },
    ],
    variants: [
      { id: "sample-rp-001", name: "Sample Leather Belt", price: 59.99, options: [] },
    ],
    price: { value: 59.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-rp-002",
    name: "Sample Travel Organizer",
    slug: "sample-travel-organizer",
    path: "/sample-travel-organizer",
    description: "Compact leather travel organizer with zippered compartments.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Travel Organizer",
      },
    ],
    variants: [
      { id: "sample-rp-002", name: "Sample Travel Organizer", price: 79.99, options: [] },
    ],
    price: { value: 79.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-rp-003",
    name: "Sample Luggage Tag",
    slug: "sample-luggage-tag",
    path: "/sample-luggage-tag",
    description: "Personalized leather luggage tag with brass hardware.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Luggage Tag",
      },
    ],
    variants: [
      { id: "sample-rp-003", name: "Sample Luggage Tag", price: 24.99, options: [] },
    ],
    price: { value: 24.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-rp-004",
    name: "Sample Toiletry Bag",
    slug: "sample-toiletry-bag",
    path: "/sample-toiletry-bag",
    description: "Water-resistant waxed canvas toiletry bag with leather trim.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Toiletry Bag",
      },
    ],
    variants: [
      { id: "sample-rp-004", name: "Sample Toiletry Bag", price: 44.99, options: [] },
    ],
    price: { value: 44.99, currencyCode: "USD" },
    options: [],
  },
];

export const MOCK_RELATED_PRODUCT_GRID_DATA: ProductGridData = {
  products: MOCK_RELATED_PRODUCTS,
  totalCount: 4,
  currentPage: 0,
  totalPages: 1,
  pageSize: 4,
  sort: "",
  isLoading: false,
  hasNextPage: false,
  hasPreviousPage: false,
  isEmpty: false,
  rangeStart: 1,
  rangeEnd: 4,
  summary: "Showing 4 related products",
};

export const MOCK_RELATED_PRODUCTS_DATA = {
  products: MOCK_RELATED_PRODUCTS,
  totalCount: 4,
  relationshipSlug: "CRP_related_products",
  relationshipName: "Related Products",
  isLoading: false,
  isEmpty: false,
};
