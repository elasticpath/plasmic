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

  return images;
};

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

  return images;
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

export const normalizeCart = (
  cart: CartEntityResponse,
  locale?: string
): Cart => {
  const data = cart.data ?? {};
  // An applied promotion comes back as a promotion_item beside the real lines.
  // It is not something the shopper bought, so it is neither a line to render
  // nor a unit to count. custom_item is kept: that is a real adjustment line.
  const items = (cart.included?.items ?? [])
    .filter((item) => item.type !== "promotion_item")
    .map(normalizeCartItem);
  return {
    ...data,
    meta: completeCartMeta(data.meta),
    items,
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
