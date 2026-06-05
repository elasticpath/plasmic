/**
 * Mock data for catalog search design-time preview in Plasmic Studio.
 *
 * Covers all 9 catalog search components. Uses "Sample" prefix to be
 * visually distinguishable from real data. Designers can bind to every
 * exposed field without requiring a real search backend.
 */

import type { Product } from "../types/product";

// ---------------------------------------------------------------------------
// Search hit products — 6 sample products matching a "leather" query
// ---------------------------------------------------------------------------

export const MOCK_SEARCH_PRODUCTS: Product[] = [
  {
    id: "sample-cs-001",
    name: "Sample Leather Messenger Bag",
    slug: "sample-leather-messenger-bag",
    path: "/sample-leather-messenger-bag",
    description:
      "Full-grain leather messenger bag with adjustable canvas strap.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Leather Messenger Bag",
      },
    ],
    variants: [
      {
        id: "sample-cs-001",
        name: "Sample Leather Messenger Bag",
        price: 159.99,
        options: [],
      },
    ],
    price: { value: 159.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-cs-002",
    name: "Sample Waxed Canvas Tote",
    slug: "sample-waxed-canvas-tote",
    path: "/sample-waxed-canvas-tote",
    description: "Durable waxed canvas tote with leather handles and base.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Waxed Canvas Tote",
      },
    ],
    variants: [
      {
        id: "sample-cs-002",
        name: "Sample Waxed Canvas Tote",
        price: 89.99,
        options: [],
      },
    ],
    price: { value: 89.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-cs-003",
    name: "Sample Leather Card Holder",
    slug: "sample-leather-card-holder",
    path: "/sample-leather-card-holder",
    description:
      "Slim vegetable-tanned leather card holder with 4 card slots.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Leather Card Holder",
      },
    ],
    variants: [
      {
        id: "sample-cs-003",
        name: "Sample Leather Card Holder",
        price: 34.99,
        options: [],
      },
    ],
    price: { value: 34.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-cs-004",
    name: "Sample Wool Felt Laptop Sleeve",
    slug: "sample-wool-felt-laptop-sleeve",
    path: "/sample-wool-felt-laptop-sleeve",
    description:
      'Premium wool felt laptop sleeve for 13" devices with leather closure.',
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Wool Felt Laptop Sleeve",
      },
    ],
    variants: [
      {
        id: "sample-cs-004",
        name: "Sample Wool Felt Laptop Sleeve",
        price: 49.99,
        options: [],
      },
    ],
    price: { value: 49.99, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-cs-005",
    name: "Sample Leather Passport Cover",
    slug: "sample-leather-passport-cover",
    path: "/sample-leather-passport-cover",
    description: "Hand-stitched leather passport cover with two card pockets.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Leather Passport Cover",
      },
    ],
    variants: [
      {
        id: "sample-cs-005",
        name: "Sample Leather Passport Cover",
        price: 42.0,
        options: [],
      },
    ],
    price: { value: 42.0, currencyCode: "USD" },
    options: [],
  },
  {
    id: "sample-cs-006",
    name: "Sample Brass Key Ring",
    slug: "sample-brass-key-ring",
    path: "/sample-brass-key-ring",
    description: "Solid brass key ring with hand-braided leather fob.",
    images: [
      {
        url: "https://static1.plasmic.app/commerce/lightweight-jacket-0.png",
        alt: "Sample Brass Key Ring",
      },
    ],
    variants: [
      {
        id: "sample-cs-006",
        name: "Sample Brass Key Ring",
        price: 19.99,
        options: [],
      },
    ],
    price: { value: 19.99, currencyCode: "USD" },
    options: [],
  },
];

// ---------------------------------------------------------------------------
// CatalogSearchData — shape exposed by EPCatalogSearchProvider
// ---------------------------------------------------------------------------

export interface CatalogSearchData {
  isSearchActive: boolean;
  query: string;
  currencyCode: string;
}

export const MOCK_CATALOG_SEARCH_DATA: CatalogSearchData = {
  isSearchActive: true,
  query: "leather",
  currencyCode: "USD",
};

// ---------------------------------------------------------------------------
// SearchFieldData — exposed by EPSearchBox to its slot children
// ---------------------------------------------------------------------------

export interface SearchFieldData {
  /** The user's in-flight input value (controls the input element). */
  value: string;
  /** The query that has actually been refined against the search backend. */
  displayValue: string;
  /** True when value is empty — useful for hiding clear buttons. */
  isEmpty: boolean;
}

export const MOCK_SEARCH_FIELD_DATA: SearchFieldData = {
  value: "leather",
  displayValue: "leather",
  isEmpty: false,
};

// ---------------------------------------------------------------------------
// RefinementItem — shape exposed per-iteration by EPRefinementList
// ---------------------------------------------------------------------------

export interface RefinementItem {
  value: string;
  label: string;
  count: number;
  isRefined: boolean;
}

export const MOCK_REFINEMENT_ITEMS: RefinementItem[] = [
  { value: "leather", label: "Leather", count: 12, isRefined: false },
  { value: "canvas", label: "Canvas", count: 8, isRefined: true },
  { value: "wool", label: "Wool", count: 5, isRefined: false },
  { value: "brass", label: "Brass", count: 3, isRefined: false },
  { value: "silk", label: "Silk", count: 2, isRefined: false },
];

// ---------------------------------------------------------------------------
// CategoryItem — shape exposed per-iteration by EPHierarchicalMenu
// ---------------------------------------------------------------------------

export interface CategoryItem {
  value: string;
  label: string;
  count: number;
  isRefined: boolean;
  depth: number;
  hasChildren: boolean;
}

export const MOCK_CATEGORY_ITEMS: CategoryItem[] = [
  {
    value: "bags",
    label: "Bags",
    count: 24,
    isRefined: true,
    depth: 0,
    hasChildren: true,
  },
  {
    value: "bags > messenger",
    label: "Messenger Bags",
    count: 8,
    isRefined: false,
    depth: 1,
    hasChildren: false,
  },
  {
    value: "bags > tote",
    label: "Tote Bags",
    count: 6,
    isRefined: false,
    depth: 1,
    hasChildren: false,
  },
  {
    value: "accessories",
    label: "Accessories",
    count: 18,
    isRefined: false,
    depth: 0,
    hasChildren: true,
  },
  {
    value: "accessories > wallets",
    label: "Wallets",
    count: 10,
    isRefined: false,
    depth: 1,
    hasChildren: false,
  },
];

// ---------------------------------------------------------------------------
// RangeData — shape exposed by EPRangeFilter
// ---------------------------------------------------------------------------

export interface RangeData {
  min: number;
  max: number;
  currentMin: number;
  currentMax: number;
  canRefine: boolean;
}

export const MOCK_RANGE_DATA: RangeData = {
  min: 0,
  max: 500,
  currentMin: 25,
  currentMax: 250,
  canRefine: true,
};

// ---------------------------------------------------------------------------
// SearchPaginationData — shape exposed by EPSearchPagination
// ---------------------------------------------------------------------------

export interface SearchPaginationData {
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  pages: number[];
  /** Wire clicks via customFunction interactions, e.g. $ctx.searchPaginationData.goTo(page). */
  goTo?: (page: number) => void;
  next?: () => void;
  prev?: () => void;
}

export const MOCK_SEARCH_PAGINATION_DATA: SearchPaginationData = {
  currentPage: 0,
  totalPages: 4,
  hasNext: true,
  hasPrev: false,
  pages: [0, 1, 2, 3],
};

// ---------------------------------------------------------------------------
// SearchStatsData — shape exposed by EPSearchStats
// ---------------------------------------------------------------------------

export interface SearchStatsData {
  nbHits: number;
  query: string;
  processingTimeMS: number;
  summary: string;
}

export const MOCK_SEARCH_STATS_DATA: SearchStatsData = {
  nbHits: 48,
  query: "leather",
  processingTimeMS: 12,
  summary: '48 results for "leather" in 12ms',
};

// ---------------------------------------------------------------------------
// ClearRefinementsData — shape exposed by EPClearRefinements
// ---------------------------------------------------------------------------

export interface ClearRefinementsData {
  canRefine: boolean;
  clear: () => void;
}

export const MOCK_CLEAR_REFINEMENTS_DATA: ClearRefinementsData = {
  canRefine: true,
  clear: () => {},
};

export const MOCK_CLEAR_REFINEMENTS_DATA_EMPTY: ClearRefinementsData = {
  canRefine: false,
  clear: () => {},
};

// ---------------------------------------------------------------------------
// CurrentRefinementChip — shape exposed per-iteration by EPCurrentRefinements
// ---------------------------------------------------------------------------

export type CurrentRefinementType =
  | "facet"
  | "exclude"
  | "disjunctive"
  | "hierarchical"
  | "numeric"
  | "query"
  | "tag";

export interface CurrentRefinementChip {
  attribute: string;
  attributeLabel: string;
  type: CurrentRefinementType;
  value: string | number;
  label: string;
  operator?: string;
  count?: number;
  refine: () => void;
}

export const MOCK_CURRENT_REFINEMENT_CHIPS: CurrentRefinementChip[] = [
  {
    attribute: "brand",
    attributeLabel: "Brand",
    type: "facet",
    value: "leather",
    label: "Leather",
    refine: () => {},
  },
  {
    attribute: "price.USD.float_price",
    attributeLabel: "Price",
    type: "numeric",
    value: 25,
    label: "25",
    operator: ">=",
    refine: () => {},
  },
  {
    attribute: "categories",
    attributeLabel: "Categories",
    type: "hierarchical",
    value: "bags > leather",
    label: "Bags > Leather",
    refine: () => {},
  },
];

// ---------------------------------------------------------------------------
// SortByData — shape exposed by EPSearchSortBy
// ---------------------------------------------------------------------------

export interface SortByData {
  currentValue: string;
  options: Array<{ value: string; label: string }>;
}

export const MOCK_SORT_BY_DATA: SortByData = {
  currentValue: "relevance",
  options: [
    { value: "relevance", label: "Most Relevant" },
    { value: "price:asc", label: "Price: Low to High" },
    { value: "price:desc", label: "Price: High to Low" },
    { value: "name:asc", label: "Name: A to Z" },
  ],
};

// ---------------------------------------------------------------------------
// AutocompleteData — shape exposed by EPSearchAutocomplete provider
// ---------------------------------------------------------------------------

export interface AutocompleteSuggestionItem {
  /** Raw suggestion text under the configured predictionsField. */
  q: string;
  /** Original adapter hit, preserved so designers can reach into highlight markup. */
  _raw?: Record<string, unknown>;
}

export interface AutocompleteCollection {
  sourceId: string;
  items: AutocompleteSuggestionItem[];
}

export interface AutocompleteData {
  /** Whether the panel should be rendered (mirrors autocomplete-core state). */
  isOpen: boolean;
  /** Current query string in the autocomplete input. */
  query: string;
  /** Per-source item collections — each source renders its own list. */
  collections: AutocompleteCollection[];
  /** Wire via customFunction interactions, e.g. $ctx.autocompleteData.clear(). */
  clear?: () => void;
  setQuery?: (value: string) => void;
}

export const MOCK_AUTOCOMPLETE_DATA: AutocompleteData = {
  isOpen: true,
  query: "leat",
  collections: [
    {
      sourceId: "predictions",
      items: [
        { q: "leather bag" },
        { q: "leather wallet" },
        { q: "leather card holder" },
      ],
    },
  ],
};

// Per-iteration context published by EPSearchAutocompleteList.
export interface CurrentSuggestion {
  item: AutocompleteSuggestionItem;
  isHighlighted: boolean;
  source: string;
  query: string;
}
