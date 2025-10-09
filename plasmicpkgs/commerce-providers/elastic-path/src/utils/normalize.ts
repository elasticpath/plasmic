import type {
  CartEntityResponse,
  CartIncluded,
  Node,
  Product as ElasticPathProduct,
  ProductData,
} from "@epcc-sdk/sdks-shopper";
import { Cart, LineItem } from "../types/cart";
import { Product, ProductOption, ProductOptionValues } from "../types/product";
import { Category } from "../types/site";
import { dedup } from "./common";

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
  __typename: "MultipleChoiceOption",
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

    if (imageObj) {
      images.push({
        url: imageObj.link?.href || "",
        alt: product.data?.attributes?.name || "",
      });
    }
  }

  // In Elastic Path, additional images would come from files relationship
  // This would need to be fetched separately or included via 'include' parameter

  return images;
};

const getProductPrice = (product: ProductData) => {
  // Try meta.display_price first (newer format)
  if (product.data?.meta?.display_price?.without_tax) {
    return money(
      product.data?.meta?.display_price.without_tax.amount,
      product.data?.meta?.display_price.without_tax.currency
    );
  }

  // Try meta.price array
  if (product.data?.meta?.display_price?.without_tax) {
    const price = product.data?.meta?.display_price?.without_tax;
    return money(price.amount, price.currency);
  }

  // Try direct price array (legacy)
  if (product.data?.meta?.display_price?.without_tax) {
    const price = product.data?.meta?.display_price?.without_tax;
    return money(price.amount, price.currency);
  }

  return money(0);
};

export const normalizeProduct = (
  product: ProductData,
  locale: string
): Product => {
  const name = product.data?.attributes?.name || "";
  const slug = product.data?.attributes?.slug || "";
  const description = product.data?.attributes?.description || "";
  const sku = product.data?.attributes?.sku || "";

  // Build options from variations metadata
  const options: ProductOption[] = [];
  if (product.data?.meta?.variations) {
    product.data?.meta.variations.forEach((variation) => {
      options.push({
        __typename: "MultipleChoiceOption",
        id: variation.id!,
        displayName: variation.name!,
        values:
          variation.options?.map((opt) => ({
            label: opt.name!,
          })) ?? ([] as ProductOptionValues[]),
      });
    });
  }

  return {
    id: product.data!.id!,
    name,
    slug,
    path: `/${slug}`,
    description,
    price: getProductPrice(product),
    images: normalizeProductImages(product),
    // In Elastic Path, variants are handled differently - would need separate API calls
    variants: [
      {
        id: product.data!.id!,
        name: name,
        price: getProductPrice(product).value,
        options: [],
      },
    ],
    options,
  };
};

const normalizeLineItem = (
  item: NonNullable<CartIncluded["items"]>[number],
  locale: string
): LineItem => {
  const unitPrice = item.meta?.display_price?.without_tax?.unit
    ? money(
        item.meta.display_price.without_tax.unit.amount,
        item.meta.display_price.without_tax.unit.currency
      )
    : item.unit_price
    ? money(item.unit_price.amount, item.unit_price.currency)
    : money(0);

  return {
    id: item.id!,
    variantId: item.product_id!, // In Elastic Path, SKU identifies the variant
    productId: item.product_id!,
    name: item.name!,
    path: item.product_id ? `/${item.product_id}` : "",
    quantity: "quantity" in item ? item.quantity : 1,
    discounts: [],
    variant: {
      id: item.product_id!,
      name: item.name!,
      sku: "",
      price: unitPrice.value,
      listPrice: unitPrice.value,
      requiresShipping: true,
    },
    options: [],
  };
};

export const normalizeCart = (
  cart: CartEntityResponse,
  locale: string
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
      ? cart.included.items.map((item) => normalizeLineItem(item, locale))
      : [],
    lineItemsSubtotalPrice: subtotal.value,
    subtotalPrice: subtotal.value,
    totalPrice: subtotal.value,
    discounts: [],
  };
};

export const normalizeCategory = (category: Node, locale: string): Category => {
  const name = category.attributes?.name || "";
  const slug = category.attributes?.slug || "";

  return {
    id: category.id!,
    name,
    slug,
    path: `/${slug}`,
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
  included?: { main_images?: Array<{ id?: string; link?: { href?: string } }> }
): Product => {
  const name = product.attributes?.name || "";
  const slug = product.attributes?.slug || "";
  const description = product.attributes?.description || "";
  const sku = product.attributes?.sku || "";

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
        __typename: "MultipleChoiceOption",
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
    const mainImage = included.main_images.find(img => img.id === mainImageId);
    
    if (mainImage?.link?.href) {
      images.push({
        url: mainImage.link.href,
        alt: name,
      });
    }
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
