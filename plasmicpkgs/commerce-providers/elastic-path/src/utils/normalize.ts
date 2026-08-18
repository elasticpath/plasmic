import type {
  CartEntityResponse,
  CartIncluded,
  CartItemObject,
  Product as EpProduct,
  Product as ElasticPathProduct,
  ProductData,
  ProductListData,
  Variation as EpVariation,
  VariationOption,
} from "@epcc-sdk/sdks-shopper";
import { Cart, LineItem } from "../types/cart";
import {
  ChildProduct,
  Product,
  ProductMeta,
  Variation,
} from "../types/product";
import { completePrice, FormattedPrice } from "./price";
import { dedup } from "./common";

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

// Build variant options from option IDs and variation metadata
const buildVariantOptions = (
  optionIds: string[],
  variations: Variation[]
): ProductOption[] => {
  const variantOptions: ProductOption[] = [];

  // Build a map of option IDs to their variations for quick lookup
  const optionToVariation = new Map<string, { variation: Variation; option: VariationOption }>();
  variations.forEach((variation) => {
    variation.options?.forEach((option) => {
      if (option.id) {
        optionToVariation.set(option.id, { variation, option });
      }
    });
  });

  // Convert option IDs to variant options
  optionIds.forEach((optionId) => {
    const optionData = optionToVariation.get(optionId);
    if (optionData) {
      variantOptions.push({
        id: optionData.variation.id!,
        displayName: optionData.variation.name!,
        values: [{ label: optionData.option.name! }],
      });
    }
  });

  return variantOptions;
};

const money = (amount?: number, currency = "USD") => {
  if (amount === undefined || amount === null) {
    return {
      value: 0,
      currencyCode: currency,
    };
  }
  return {
    value: amount / 100, // Elastic Path stores amounts in cents
    currencyCode: currency,
  };
};

const normalizeProductOption = (option: {
  name: string;
  values: string[];
}): ProductOption => ({
  id: option.name,
  displayName: option.name,
  values: dedup(option.values).map((val) => {
    // Check if it's a color option with hex value
    if (
      option.name.match(/colou?r/gi) &&
      /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/i.test(val)
    ) {
      return {
        label: val,
        hexColors: [val],
      };
    } else {
      return {
        label: val,
      };
    }
  }),
});

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

const getProductPrice = (
  product: ProductData,
  childProducts?: ProductListData
) => {
  // Primary: parent product carries its own display_price (simple products,
  // or PXM groups where pricing is replicated up the tree).
  if (product.data?.meta?.display_price?.without_tax) {
    return money(
      product.data.meta.display_price.without_tax.amount,
      product.data.meta.display_price.without_tax.currency
    );
  }

  // Fallback: PXM variation parent ("base-product") products carry no
  // display_price of their own — every variant child does. Inherit currency
  // (and a representative amount) from the first child that has a price so
  // that `Product.price.currencyCode` resolves to the right value instead of
  // falling back to the money() default of USD.
  const firstChildWithPrice = childProducts?.data?.find(
    (c) => c?.meta?.display_price?.without_tax?.amount != null
  );
  if (firstChildWithPrice?.meta?.display_price?.without_tax) {
    return money(
      firstChildWithPrice.meta.display_price.without_tax.amount,
      firstChildWithPrice.meta.display_price.without_tax.currency
    );
  }

  return money(0);
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
    optionIds:
      (child.id && matrix
        ? getOptionsFromSkuId(child.id, matrix)
        : undefined) ?? [],
    images: [],
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

/**
 * Extract selected variation options from EP's custom_inputs field.
 * When adding to cart we store them as `_selectedOptions` in custom_inputs.
 */
function extractOptionsFromCustomInputs(
  customInputs: Record<string, unknown> | undefined
): { name: string; value: string; id?: string }[] {
  if (!customInputs?._selectedOptions) return [];
  const raw = customInputs._selectedOptions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o: any) =>
      o && typeof o.name === "string" && typeof o.value === "string"
  );
}

const normalizeLineItem = (
  item: NonNullable<CartIncluded["items"]>[number]
): LineItem => {
  const unitPrice = item.meta?.display_price?.without_tax?.unit
    ? money(
        item.meta.display_price.without_tax.unit.amount,
        item.meta.display_price.without_tax.unit.currency
      )
    : item.unit_price
    ? money(item.unit_price.amount, item.unit_price.currency)
    : money(0);

  // CartItemObject and CustomItemCartObject have custom_inputs; narrow the union
  const epItem = item as CartItemObject;
  const options = extractOptionsFromCustomInputs(epItem.custom_inputs);

  const lineItem: LineItem & { locationSlug?: string } = {
    id: item.id!,
    variantId: item.product_id!, // In Elastic Path, SKU identifies the variant
    productId: item.product_id!,
    name: item.name!,
    path: item.product_id ? `/${item.product_id}` : "",
    quantity: "quantity" in item ? item.quantity : 1,
    variant: {
      id: item.product_id!,
      name: item.name!,
      sku: "",
      price: unitPrice.value,
      listPrice: unitPrice.value,
      requiresShipping: true,
    },
    options,
  };

  // Carry through the location slug from the EP cart item response.
  // Read via a wide cast — the shopper SDK response type omits `location`
  // on CartItemResponse even though EP returns it for multilocation lines.
  const locationSlug = (epItem as { location?: string }).location;
  if (locationSlug) {
    lineItem.locationSlug = locationSlug;
  }

  return lineItem;
};

export const normalizeCart = (
  cart: CartEntityResponse,
  locale?: string
): Cart => {
  const cartTotal =
    cart.data?.meta?.display_price?.with_tax ||
    cart.data?.meta?.display_price?.without_tax;
  const subtotal = cartTotal
    ? money(cartTotal.amount, cartTotal.currency)
    : money(0);

  return {
    id: cart.data!.id!,
    customerId: "", // Would come from cart.relationships.customers if present
    email: "", // Not typically stored on cart in Elastic Path
    createdAt:
      cart.data?.meta?.timestamps?.created_at || new Date().toISOString(),
    currency: {
      code: subtotal.currencyCode,
    },
    taxesIncluded: true, // Elastic Path handles tax calculation
    lineItems: cart.included?.items
      ? cart.included.items.map((item) => normalizeLineItem(item))
      : [],
    lineItemsSubtotalPrice: subtotal.value,
    subtotalPrice: subtotal.value,
    totalPrice: subtotal.value,
  };
};

/**
 * Normalize a product from the ProductListData response (from getByContextAllProducts)
 * This handles the direct Product type from the list, which has a different structure
 * than ProductData which wraps a single product.
 */
export const normalizeProductFromList = (
  product: ElasticPathProduct,
  locale: string,
  included?: {
    main_images?: Array<{ id?: string; link?: { href?: string } }>;
    files?: Array<{ id?: string; link?: { href?: string } }>;
  }
): Product => {
  const name = product.attributes?.name || "";
  const slug = product.attributes?.slug || "";
  const description = product.attributes?.description || "";

  // For list products, price info is in meta.display_price
  const price = product.meta?.display_price?.without_tax
    ? money(
        product.meta.display_price.without_tax.amount,
        product.meta.display_price.without_tax.currency
      )
    : money(0);

  // Build options from variations metadata
  const options: ProductOption[] = [];
  if (product.meta?.variations) {
    product.meta.variations.forEach((variation) => {
      options.push({
        id: variation.id!,
        displayName: variation.name!,
        values:
          variation.options?.map((opt) => ({
            label: opt.name!,
          })) ?? ([] as ProductOptionValues[]),
      });
    });
  }

  // For list products, we need to handle images from the included data
  const images: Array<{ url: string; alt?: string }> = [];

  // Check if product has a main_image relationship and if the image is in included
  if (product.relationships?.main_image?.data?.id && included?.main_images) {
    const mainImageId = product.relationships.main_image.data.id;
    const mainImage = included.main_images.find(
      (img) => img.id === mainImageId
    );

    if (mainImage?.link?.href) {
      images.push({
        url: mainImage.link.href,
        alt: name,
      });
    }
  }

  // Add additional images from files relationship
  if (product.relationships?.files?.data && included?.files) {
    product.relationships.files.data.forEach((fileRef) => {
      const file = included.files?.find((f) => f.id === fileRef.id);
      if (file?.link?.href) {
        images.push({
          url: file.link.href,
          alt: name,
        });
      }
    });
  }

  return {
    id: product.id!,
    name,
    slug,
    path: `/${slug}`,
    description,
    price,
    images,
    variants: [
      {
        id: product.id!,
        name: name,
        price: price.value,
        options: [],
      },
    ],
    options,
  };
};
