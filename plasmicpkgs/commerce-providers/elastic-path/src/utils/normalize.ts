import type {
  CartEntityResponse,
  CartIncluded,
  Product as EpProduct,
  Product as ElasticPathProduct,
  ProductData,
  ProductListData,
  Variation as EpVariation,
} from "@epcc-sdk/sdks-shopper";
import { Cart, CartItem, CartMeta } from "../types/cart";
import {
  ChildProduct,
  Product,
  ProductImage,
  ProductMeta,
  Variation,
} from "../types/product";
import { isShippingLine } from "../checkout/session/shipping-line-sku";
import { completePrice, FormattedPrice } from "./price";

// Variation matrix is a nested object mapping option IDs to child product IDs
type VariationMatrixEntry = string | { [key: string]: VariationMatrixEntry };

// Helper function to find option IDs for a given child product ID in the variation matrix
const getOptionsFromSkuId = (
  skuId: string,
  entry: VariationMatrixEntry,
  options: string[] = []
): string[] | undefined => {
  if (typeof entry === "string") {
    return entry === skuId ? options : undefined;
  }

  let acc: string[] | undefined;
  Object.keys(entry).every((key) => {
    const result = getOptionsFromSkuId(skuId, entry[key], [...options, key]);
    if (result) {
      acc = result;
      return false;
    }
    return true;
  });
  return acc;
};

/** EP references one file from both `main_image` and `files`. */
const dedupeByUrl = <T extends { url: string }>(images: T[]): T[] => {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
};

const normalizeProductImages = (product: ProductData) => {
  const images: Array<{ url: string; alt?: string }> = [];

  // Check main image
  if (product.data?.relationships?.main_image?.data?.id) {
    const imageObj = product.included?.main_images?.find(
      (img) => img.id === product.data?.relationships?.main_image?.data?.id
    );

    if (imageObj && imageObj.link?.href) {
      images.push({
        url: imageObj.link.href,
        alt: product.data?.attributes?.name || "",
      });
    }
  }

  // Add additional images from files relationship
  if (product.data?.relationships?.files?.data && product.included?.files) {
    product.data.relationships.files.data.forEach((fileRef) => {
      const file = product.included?.files?.find((f) => f.id === fileRef.id);
      if (file?.link?.href) {
        images.push({
          url: file.link.href,
          alt: product.data?.attributes?.name || "",
        });
      }
    });
  }

  return dedupeByUrl(images);
};

export const primaryImageUrl = (
  product: ElasticPathProduct,
  included?: ProductData["included"]
): string | undefined =>
  normalizeProductImages({ data: product, included })[0]?.url;

/**
 * A base product carries no `display_price` of its own — every child does.
 * The lowest of them is the "from" price a variation family displays.
 */
const lowestChildPrice = (
  childProducts?: ProductListData
): FormattedPrice | undefined =>
  (childProducts?.data ?? [])
    .map((child) => completePrice(child.meta?.display_price?.without_tax))
    .filter((price): price is FormattedPrice => !!price)
    .sort((a, b) => a.amount - b.amount)[0];

/**
 * A child's own images, resolved from the list response's shared `included`
 * block. The child fetch already asks for `main_image` and `files`.
 */
const normalizeChildImages = (
  child: NonNullable<ProductListData["data"]>[number],
  included: ProductListData["included"]
): ProductImage[] => {
  const images: ProductImage[] = [];
  const alt = child.attributes?.name || "";

  const mainImageId = child.relationships?.main_image?.data?.id;
  if (mainImageId) {
    const mainImage = included?.main_images?.find(
      (img) => img.id === mainImageId
    );
    if (mainImage?.link?.href) {
      images.push({ url: mainImage.link.href, alt });
    }
  }

  child.relationships?.files?.data?.forEach((fileRef) => {
    const file = included?.files?.find((f) => f.id === fileRef.id);
    if (file?.link?.href) {
      images.push({ url: file.link.href, alt });
    }
  });

  return dedupeByUrl(images);
};

/** An Elastic Path custom field, on either leaf depending on how it was set. */
const readBundleExcluded = (child: unknown): boolean | undefined => {
  const c = child as { meta?: any; attributes?: any } | undefined;
  if (c?.meta?.bundle_excluded === true) return true;
  if (c?.attributes?.bundle_excluded === true) return true;
  return undefined;
};

const normalizeChildProducts = (
  product: ProductData,
  childProducts?: ProductListData
): ChildProduct[] => {
  const matrix = product.data?.meta?.variation_matrix as
    | VariationMatrixEntry
    | undefined;

  return (childProducts?.data ?? []).map((child) => ({
    id: child.id!,
    name: child.attributes?.name || "",
    sku: child.attributes?.sku,
    price: completePrice(child.meta?.display_price?.without_tax),
    priceWithTax: completePrice(child.meta?.display_price?.with_tax),
    optionIds:
      (child.id && matrix
        ? getOptionsFromSkuId(child.id, matrix)
        : undefined) ?? [],
    images: normalizeChildImages(child, childProducts?.included),
    bundleExcluded: readBundleExcluded(child),
  }));
};

/** Ascending by the merchandiser's `sort_order`; anything without one sorts last. */
const bySortOrder = <T extends { sort_order?: number | null }>(items: T[]): T[] =>
  [...items].sort(
    (a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
  );

const normalizeVariations = (variations: EpVariation[] | undefined): Variation[] =>
  bySortOrder(variations ?? []).map((variation) => ({
    id: variation.id!,
    name: variation.name!,
    sortOrder: variation.sort_order ?? undefined,
    options: bySortOrder(variation.options ?? []).map((option) => ({
      id: option.id!,
      name: option.name!,
      description: option.description,
      sortOrder: option.sort_order ?? undefined,
    })),
  }));

const completeDisplayPrice = (
  displayPrice: { with_tax?: any; without_tax?: any } | undefined
) =>
  displayPrice && {
    ...displayPrice,
    with_tax: completePrice(displayPrice.with_tax),
    without_tax: completePrice(displayPrice.without_tax),
  };

const completeMeta = (meta: EpProduct["meta"]): ProductMeta | undefined =>
  meta && {
    ...meta,
    display_price: completeDisplayPrice(meta.display_price),
    original_display_price: completeDisplayPrice(meta.original_display_price),
  };

export const normalizeProduct = (
  product: ProductData,
  locale: string,
  childProducts?: ProductListData
): Product => {
  const data = product.data ?? {};
  return {
    ...data,
    meta: completeMeta(data.meta),
    images: normalizeProductImages(product),
    variations: normalizeVariations(data.meta?.variations),
    childProducts: normalizeChildProducts(product, childProducts),
    ...(data.meta?.display_price
      ? {}
      : { priceFrom: lowestChildPrice(childProducts) }),
  };
};

const CART_ITEM_PRICE_KEYS = [
  "with_tax",
  "without_tax",
  "tax",
  "discount",
] as const;

/** EP omits `float_price` on line prices; complete both the unit and the line total. */
const normalizeCartItem = (
  item: NonNullable<CartIncluded["items"]>[number]
): CartItem => {
  const displayPrice = (item as any).meta?.display_price;
  if (!displayPrice) return item as CartItem;
  const completed: Record<string, unknown> = { ...displayPrice };
  CART_ITEM_PRICE_KEYS.forEach((key) => {
    const pair = displayPrice[key];
    if (!pair) return;
    completed[key] = {
      ...pair,
      unit: completePrice(pair.unit),
      value: completePrice(pair.value),
    };
  });
  return {
    ...(item as object),
    meta: { ...(item as any).meta, display_price: completed },
  } as CartItem;
};

const CART_PRICE_KEYS = [
  "with_tax",
  "without_tax",
  "tax",
  "discount",
  "without_discount",
  "shipping",
] as const;

const completeCartMeta = (
  meta: NonNullable<CartEntityResponse["data"]>["meta"]
): CartMeta | undefined => {
  if (!meta) return undefined;
  const displayPrice = (meta as any).display_price;
  if (!displayPrice) return meta as CartMeta;
  const completed: Record<string, unknown> = { ...displayPrice };
  CART_PRICE_KEYS.forEach((key) => {
    if (displayPrice[key]) completed[key] = completePrice(displayPrice[key]);
  });
  return { ...(meta as object), display_price: completed } as CartMeta;
};

type RawLine = NonNullable<CartIncluded["items"]>[number];

const LINE_PRICE_KEYS = [
  "with_tax",
  "without_tax",
  "tax",
  "discount",
  "without_discount",
] as const;

/** A line's priced value for one display-price key, after discounts. */
function lineValue(line: RawLine, key: (typeof LINE_PRICE_KEYS)[number]): number {
  const l = line as any;
  const priced = l.meta?.display_price?.[key]?.value?.amount;
  if (typeof priced === "number") return priced;
  if (key === "tax" || key === "discount") return 0;
  return l.value?.amount ?? (l.unit_price?.amount ?? 0) * (l.quantity ?? 1);
}

/** What one promotion code took off a line. */
function lineDiscount(line: RawLine, code: string): number {
  const l = line as any;
  const priced = l.meta?.display_price?.discounts?.[code]?.amount;
  if (typeof priced === "number") return priced;
  const listed = Array.isArray(l.discounts)
    ? l.discounts.find((d: any) => d?.code === code)?.amount?.amount
    : undefined;
  return typeof listed === "number" ? listed : 0;
}

/** The price less `minus`, re-formatted; unchanged when nothing comes off. */
function lessAmount(price: any, minus: number): any {
  if (!price || typeof price.amount !== "number" || minus === 0) return price;
  return { amount: price.amount - minus, currency: price.currency };
}

/** Cart totals as if the checkout's shipping lines were not in the cart. */
function cartMetaWithoutShipping(meta: any, shippingLines: RawLine[]): any {
  const displayPrice = meta?.display_price;
  if (!displayPrice || shippingLines.length === 0) return meta;
  const adjusted: Record<string, unknown> = { ...displayPrice };
  LINE_PRICE_KEYS.forEach((key) => {
    const minus = shippingLines.reduce((sum, l) => sum + lineValue(l, key), 0);
    if (displayPrice[key]) adjusted[key] = lessAmount(displayPrice[key], minus);
  });
  return { ...meta, display_price: adjusted };
}

/** A promotion line less what it took off the shipping lines. */
function promotionWithoutShipping(promotion: RawLine, shippingLines: RawLine[]): RawLine {
  const p = promotion as any;
  const code = p.sku ?? p.code;
  const displayPrice = p.meta?.display_price;
  if (!code || !displayPrice || shippingLines.length === 0) return promotion;
  const minus = shippingLines.reduce((sum, l) => sum + lineDiscount(l, code), 0);
  if (minus === 0) return promotion;
  const quantity = typeof p.quantity === "number" && p.quantity > 0 ? p.quantity : 1;
  const adjusted: Record<string, unknown> = { ...displayPrice };
  (["with_tax", "without_tax"] as const).forEach((key) => {
    const pair = displayPrice[key];
    if (!pair) return;
    adjusted[key] = {
      ...pair,
      unit: lessAmount(pair.unit, minus / quantity),
      value: lessAmount(pair.value, minus),
    };
  });
  return { ...p, meta: { ...p.meta, display_price: adjusted } };
}

export const normalizeCart = (
  cart: CartEntityResponse,
  locale?: string
): Cart => {
  const { id: _id, links: _links, ...data } = cart.data ?? {};
  // An applied promotion comes back as a promotion_item beside the real lines.
  // It is not something the shopper bought, so it is neither a line to render
  // nor a unit to count — but it is what tells the promo input a code is still
  // applied, so it is published separately rather than dropped. custom_item is
  // kept as a line: that is a real adjustment. The checkout's shipping line is
  // not a line or a unit; `meta` and `promotions` keep Elastic Path's money
  // as it is, and `withoutShipping` totals the cart without that line.
  const rawItems = cart.included?.items ?? [];
  const shippingLines = rawItems.filter(isShippingLine);
  const shopperItems = rawItems.filter((item) => !isShippingLine(item));
  const items = shopperItems
    .filter((item) => item.type !== "promotion_item")
    .map(normalizeCartItem);
  const rawPromotions = shopperItems.filter((item) => item.type === "promotion_item");
  const meta = completeCartMeta(data.meta);
  const promotions = rawPromotions.map(normalizeCartItem);
  return {
    ...data,
    meta,
    items,
    promotions,
    withoutShipping:
      shippingLines.length === 0
        ? { meta, promotions }
        : {
            meta: completeCartMeta(cartMetaWithoutShipping(data.meta, shippingLines)),
            promotions: rawPromotions
              .map((p) => promotionWithoutShipping(p, shippingLines))
              .map(normalizeCartItem),
          },
    itemCount: items.reduce(
      (units, item) => units + ("quantity" in item ? item.quantity ?? 0 : 0),
      0
    ),
  };
};

/**
 * A product from `getByContextAllProducts` is Elastic Path's same `Product`
 * resource as `getByContextProduct` returns — only the envelope differs. Rewrap
 * it so both paths produce an identical shape from one implementation.
 */
export const normalizeProductFromList = (
  product: ElasticPathProduct,
  locale: string,
  included?: ProductData["included"]
): Product => normalizeProduct({ data: product, included }, locale);
