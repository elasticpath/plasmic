import type { ProductData } from "@epcc-sdk/sdks-shopper";

export type ProductImage = {
  url: string;
  alt?: string;
};

export type ProductPrice = {
  value: number;
  currencyCode?: string;
};

export type ProductOptionValues = {
  label: string;
  hexColors?: string[];
};

export type ProductOption = {
  id: string;
  displayName: string;
  values: ProductOptionValues[];
};

export type ProductVariant = {
  id: string | number;
  name: string;
  options: ProductOption[];
  price?: number;
  availableForSale?: boolean;
};

/**
 * Field names here are a saved-binding contract: EPProductProvider pushes this
 * object through DataProvider, so designers reach them as `$ctx.currentProduct.*`.
 * Renaming one breaks published storefronts with no build or test failure.
 */
export type Product = {
  id: string;
  name: string;
  description: string;
  sku?: string;
  slug?: string;
  path?: string;
  images: ProductImage[];
  variants: ProductVariant[];
  price: ProductPrice;
  options: ProductOption[];
  rawData?: ProductData;
};
