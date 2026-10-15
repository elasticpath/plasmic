import type { Product } from "../types/product";

export const DEFAULT_PRODUCT_PATH_PREFIX = "/product";

export const PRODUCT_PATH_PREFIX_PROP = {
  type: "string",
  displayName: "Product Path Prefix",
  description:
    "Route prefix used to build each card's currentHit.path link (prefix + '/' + slug). Set this to match the storefront's PDP route, e.g. \"/products\".",
  defaultValue: DEFAULT_PRODUCT_PATH_PREFIX,
} as const;

/**
 * A product's PDP route. The last segment is its product reference — the slug,
 * or the id when it has none — which is exactly what `ep.getProduct` reads.
 */
export function productPath(
  product: Product,
  productPathPrefix: string = DEFAULT_PRODUCT_PATH_PREFIX
): string {
  const prefix = (productPathPrefix || DEFAULT_PRODUCT_PATH_PREFIX).replace(
    /\/+$/,
    ""
  );
  return `${prefix}/${product.attributes?.slug || product.id}`;
}

export function productHitMeta(
  product: Product,
  productPathPrefix?: string
): { path: string; raw: Record<string, any> } {
  return { path: productPath(product, productPathPrefix), raw: {} };
}
