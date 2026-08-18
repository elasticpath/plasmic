import type { Product as EpProduct } from "@epcc-sdk/sdks-shopper";
import type { FormattedPrice } from "../utils/price";

type EpProductMeta = NonNullable<EpProduct["meta"]>;

export type ProductImage = {
  url: string;
  alt?: string;
};

/** One choice within a variation, e.g. "Large" under "Size". */
export type VariationOption = {
  id: string;
  name: string;
  description?: string;
  sortOrder?: number;
};

/** An option group a shopper chooses from to select a child product. */
export type Variation = {
  id: string;
  name: string;
  sortOrder?: number;
  options: VariationOption[];
};

/** A purchasable product selected by one combination of variation options. */
export type ChildProduct = {
  id: string;
  name: string;
  sku?: string;
  price?: FormattedPrice;
  /** The variation options that select this child, from `meta.variation_matrix`. */
  optionIds: string[];
  images: ProductImage[];
};

type CompletedDisplayPrice = {
  with_tax?: FormattedPrice;
  without_tax?: FormattedPrice;
};

export type ProductMeta = Omit<
  EpProductMeta,
  "display_price" | "original_display_price"
> & {
  display_price?: CompletedDisplayPrice;
  original_display_price?: CompletedDisplayPrice;
};

/**
 * Elastic Path's product, augmented with only what a Studio binding expression
 * cannot compute. See docs/adr/0002-augmented-ep-shapes-not-normalized.md.
 */
export type Product = Omit<EpProduct, "meta"> & {
  meta?: ProductMeta;
  /** Joined from `relationships` and the response's `included` block. */
  images: ProductImage[];
  /** `meta.variations`, in the merchandiser's sort order. */
  variations: Variation[];
  /** Flattened out of `meta.variation_matrix`. */
  childProducts: ChildProduct[];
  /** Base products only: the lowest price among the children. */
  priceFrom?: FormattedPrice;
};
