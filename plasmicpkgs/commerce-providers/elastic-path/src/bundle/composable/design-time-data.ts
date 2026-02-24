/**
 * Mock data for composable bundle components in Plasmic Studio.
 *
 * Covers: multi-component bundle, single-select, multi-select,
 * parent products with variations, fixed pricing, cumulative pricing.
 * Uses "Sample" prefix for clear visual distinction from live data.
 */

export interface MockBundleData {
  isValid: boolean;
  errors: string[];
  pricingType: "fixed" | "cumulative";
  currentPrice: string;
  isConfiguring: boolean;
  componentCount: number;
}

export interface MockBundleComponent {
  name: string;
  key: string;
  min: number;
  max: number;
  selectedCount: number;
  isValid: boolean;
  sortOrder: number;
  sort_order?: number | null;
  options: MockBundleOption[];
}

export interface MockBundleOption {
  id: string;
  name: string;
  quantity: number;
  minQty: number | null;
  maxQty: number | null;
  isSelected: boolean;
  isParentProduct: boolean;
  price: string;
  imageUrl: string;
  sortOrder: number;
  sort_order?: number | null;
  isDefault: boolean;
  sku: string;
  description: string;
}

export interface MockBundleVariation {
  id: string;
  name: string;
  values: { label: string }[];
}

export interface MockBundleVariationOption {
  label: string;
  isSelected: boolean;
}

// ---------------------------------------------------------------------------
// Mock bundle data — mimics a laptop configurator bundle
// ---------------------------------------------------------------------------

export const MOCK_BUNDLE_DATA: MockBundleData = {
  isValid: true,
  errors: [],
  pricingType: "cumulative",
  currentPrice: "$1,249.00",
  isConfiguring: false,
  componentCount: 3,
};

export const MOCK_BUNDLE_DATA_WITH_ERRORS: MockBundleData = {
  isValid: false,
  errors: [
    "Please select one option for Processor",
    "Please select at least 1 option for Storage",
  ],
  pricingType: "cumulative",
  currentPrice: "$899.00",
  isConfiguring: false,
  componentCount: 3,
};

export const MOCK_BUNDLE_COMPONENTS: MockBundleComponent[] = [
  {
    name: "Sample Processor",
    key: "processor",
    min: 1,
    max: 1,
    selectedCount: 1,
    isValid: true,
    sortOrder: 1,
    options: [
      {
        id: "opt-proc-1",
        name: "Sample Core i5",
        quantity: 1,
        minQty: null,
        maxQty: null,
        isSelected: true,
        isParentProduct: false,
        price: "$299.00",
        imageUrl: "",
        sortOrder: 1,
        isDefault: true,
        sku: "PROC-I5",
        description: "6-core processor, 3.5GHz base clock",
      },
      {
        id: "opt-proc-2",
        name: "Sample Core i7",
        quantity: 1,
        minQty: null,
        maxQty: null,
        isSelected: false,
        isParentProduct: false,
        price: "$499.00",
        imageUrl: "",
        sortOrder: 2,
        isDefault: false,
        sku: "PROC-I7",
        description: "8-core processor, 4.0GHz base clock",
      },
    ],
  },
  {
    name: "Sample Memory",
    key: "memory",
    min: 1,
    max: 3,
    selectedCount: 1,
    isValid: true,
    sortOrder: 2,
    options: [
      {
        id: "opt-mem-1",
        name: "Sample 8GB DDR5",
        quantity: 1,
        minQty: 1,
        maxQty: 4,
        isSelected: true,
        isParentProduct: false,
        price: "$79.00",
        imageUrl: "",
        sortOrder: 1,
        isDefault: true,
        sku: "MEM-8GB",
        description: "DDR5-4800 SO-DIMM",
      },
      {
        id: "opt-mem-2",
        name: "Sample 16GB DDR5",
        quantity: 0,
        minQty: 1,
        maxQty: 2,
        isSelected: false,
        isParentProduct: false,
        price: "$149.00",
        imageUrl: "",
        sortOrder: 2,
        isDefault: false,
        sku: "MEM-16GB",
        description: "DDR5-5600 SO-DIMM",
      },
    ],
  },
  {
    name: "Sample Storage",
    key: "storage",
    min: 1,
    max: 2,
    selectedCount: 1,
    isValid: true,
    sortOrder: 3,
    options: [
      {
        id: "opt-stor-1",
        name: "Sample 512GB SSD",
        quantity: 1,
        minQty: null,
        maxQty: null,
        isSelected: true,
        isParentProduct: true,
        price: "$99.00",
        imageUrl: "",
        sortOrder: 1,
        isDefault: true,
        sku: "SSD-512",
        description: "NVMe M.2 SSD",
      },
      {
        id: "opt-stor-2",
        name: "Sample 1TB SSD",
        quantity: 0,
        minQty: null,
        maxQty: null,
        isSelected: false,
        isParentProduct: false,
        price: "$179.00",
        imageUrl: "",
        sortOrder: 2,
        isDefault: false,
        sku: "SSD-1TB",
        description: "NVMe M.2 SSD",
      },
    ],
  },
];

export const MOCK_BUNDLE_VARIATIONS: MockBundleVariation[] = [
  {
    id: "var-color",
    name: "Color",
    values: [{ label: "Space Gray" }, { label: "Silver" }, { label: "Gold" }],
  },
  {
    id: "var-capacity",
    name: "Capacity",
    values: [{ label: "512GB" }, { label: "1TB" }],
  },
];

export const MOCK_BUNDLE_VARIATION_OPTIONS: MockBundleVariationOption[] = [
  { label: "Space Gray", isSelected: true },
  { label: "Silver", isSelected: false },
  { label: "Gold", isSelected: false },
];
