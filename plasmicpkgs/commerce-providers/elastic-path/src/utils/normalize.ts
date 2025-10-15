import type {
  CartEntityResponse,
  CartIncluded,
  Product as ElasticPathProduct,
  Node,
  ProductData,
  ProductListData,
} from "@epcc-sdk/sdks-shopper";
import { Cart, LineItem } from "../types/cart";
import {
  Product,
  ProductOption,
  ProductOptionValues,
  ProductVariant,
} from "../types/product";
import { Category } from "../types/site";
import { dedup } from "./common";

// Helper function to find option IDs for a given child product ID in the variation matrix
const getOptionsFromSkuId = (
  skuId: string,
  entry: any,
  options: string[] = []
): string[] | undefined => {
  if (typeof entry === "string") {
    return entry === skuId ? options : undefined;
  }

  let acc: string[] | undefined;
  Object.keys(entry).every((key) => {
    const result = getOptionsFromSkuId(
      skuId,
      entry[key],
      [...options, key]
    );
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
  variations: any[]
): ProductOption[] => {
  const variantOptions: ProductOption[] = [];
  
  // Build a map of option IDs to their variations for quick lookup
  const optionToVariation = new Map<string, { variation: any; option: any }>();
  variations.forEach((variation) => {
    variation.options?.forEach((option: any) => {
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
        __typename: "MultipleChoiceOption" as const,
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
  locale: string,
  childProducts?: ProductListData
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

  // Build variants from child products if available
  const parentPrice = getProductPrice(product);
  
  let variants: ProductVariant[] = [
    {
      id: product.data!.id!,
      name: name,
      price: parentPrice.value,
      availableForSale: false, // Parent products are never available for sale
      options: [],
    },
  ];

  if (childProducts?.data && childProducts.data.length > 0) {
    // Replace with actual child product variants
    variants = childProducts.data.map((childProduct) => {
      const childPrice = childProduct.meta?.display_price?.without_tax
        ? money(
            childProduct.meta.display_price.without_tax.amount,
            childProduct.meta.display_price.without_tax.currency
          )
        : money(0);


      // Map variation values from child product
      const variantOptions: ProductOption[] = [];

      // The variation_matrix is on the parent product, not the child
      // It maps variation combinations to child product IDs
      
      if (
        product.data?.meta?.variation_matrix &&
        product.data?.meta?.variations
      ) {
        // Find the variation combination for this child product
        // The variation_matrix maps combinations like "size:small,color:brown" to child IDs
        const childId = childProduct.id;
        
        if (!childId) {
          return {
            id: "",
            name: childProduct.attributes?.name || "",
            price: childPrice.value,
            options: [],
          };
        }

        // Find the option IDs for this child product
        const optionIds = getOptionsFromSkuId(childId, product.data.meta.variation_matrix);
        
        if (optionIds && optionIds.length > 0 && product.data?.meta?.variations) {
          variantOptions.push(...buildVariantOptions(optionIds, product.data.meta.variations));
        }
      }

      // Use the raw amount value directly if display_price is already formatted
      const rawPrice = childProduct.meta?.display_price?.without_tax?.amount || 0;
      const formattedPrice = typeof rawPrice === 'number' ? rawPrice / 100 : parseFloat(rawPrice) || 0;
      
      // Determine availability based on status and price
      const isLive = childProduct.attributes?.status === 'live';
      const hasPrice = formattedPrice > 0;
      
      return {
        id: childProduct.id!,
        name: childProduct.attributes?.name || "",
        price: formattedPrice,
        availableForSale: isLive && hasPrice,
        options: variantOptions,
      };
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
    variants,
    options,
  };
};

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
  cart: CartEntityResponse
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
    discounts: [],
  };
};

export const normalizeCategory = (category: Node, locale: string): Category => {
  // locale parameter kept for future internationalization support
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
