import type {
  CartItemObject,
  CartResponse as EpCart,
} from "@epcc-sdk/sdks-shopper";
import type { FormattedPrice } from "../utils/price";

/** A variation option chosen at add-to-cart time, persisted in `custom_inputs`. */
export type SelectedOption = {
  id?: string;
  name: string;
  value: string;
};

type EpCartMeta = NonNullable<EpCart["meta"]>;
/** EP's cart line. The union `CartIncluded["items"]` also covers custom and
 * subscription items; a storefront line is always this one. */
type EpCartItem = CartItemObject;

export type CartMeta = Omit<EpCartMeta, "display_price"> & {
  display_price?: {
    with_tax?: FormattedPrice;
    without_tax?: FormattedPrice;
    tax?: FormattedPrice;
    discount?: FormattedPrice;
    without_discount?: FormattedPrice;
    shipping?: FormattedPrice;
  };
};

type CartItemPricePair = {
  unit?: FormattedPrice;
  value?: FormattedPrice;
};

export type CartItem = EpCartItem & {
  meta?: {
    display_price?: {
      with_tax?: CartItemPricePair;
      without_tax?: CartItemPricePair;
      without_discount?: CartItemPricePair;
      discount?: CartItemPricePair;
      tax?: CartItemPricePair;
    };
  };
  custom_inputs?: Record<string, unknown>;
  /** EP returns this for multilocation lines; the shopper SDK type omits it. */
  location?: string;
};

/**
 * Elastic Path's cart, augmented with only what a Studio binding expression
 * cannot compute. See docs/adr/0002-augmented-ep-shapes-not-normalized.md.
 */
export type Cart = Omit<EpCart, "meta"> & {
  meta?: CartMeta;
  /** Elastic Path side-loads these under `included`. */
  items: CartItem[];
  /** Quantity sum; Elastic Path exposes only a line count. */
  itemCount: number;
};
