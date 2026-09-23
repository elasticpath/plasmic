import {
  getByContextAllProducts,
  getByContextChildProducts,
} from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { batchProductIds } from "./product-batches";
import type { EpServerAuth } from "./types";

export interface EpChildProduct {
  id: string;
  name?: string;
  sku?: string;
  price?: string;
  attributes?: Record<string, unknown>;
  /** EP custom field: the variation is excluded from the bundle. */
  excluded?: boolean;
}

export interface EpProductVariation {
  id: string;
  name: string;
  options?: Array<{ id: string; name: string }>;
}

/**
 * A bundle option product with whatever variation structure it carries.
 *
 * `error` is a message, not an `Error`: this value crosses `JSON.stringify`
 * on the way through `/api/ep/proxy`, which flattens an Error to `{}`.
 */
export interface EpParentProduct {
  id: string;
  isParent: boolean;
  children: EpChildProduct[];
  variations: EpProductVariation[];
  variationMatrix?: Record<string, unknown>;
  error?: string;
}

export interface EpGetParentProductsInput {
  productIds: string[];
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

function readVariations(product: any): EpProductVariation[] {
  const variations = product?.meta?.variations ?? [];
  if (!Array.isArray(variations)) return [];
  return variations
    .filter((v: any) => v?.id && v?.name)
    .map((v: any) => ({
      id: v.id,
      name: v.name,
      options: Array.isArray(v.options)
        ? v.options
            .filter((o: any) => o?.id && o?.name)
            .map((o: any) => ({ id: o.id, name: o.name }))
        : undefined,
    }));
}

function isExcluded(child: any): boolean {
  return (
    child?.meta?.bundle_excluded === true ||
    child?.attributes?.bundle_excluded === true
  );
}

/**
 * Which of the given products are parents, and the child variations of each.
 *
 * Two phases in one call, as the browser hook does it: read the products to
 * find the parents, then read each parent's children. A product the catalog
 * does not return is reported as a non-parent carrying `error`, so a deleted
 * option is distinguishable from one with no variations.
 */
export async function epGetParentProducts({
  productIds,
  auth: inputAuth,
}: EpGetParentProductsInput): Promise<Record<string, EpParentProduct>> {
  const ids = (productIds ?? []).filter(Boolean);
  if (ids.length === 0) return {};
  const auth = getCurrentEpSession() ?? inputAuth;

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<Record<string, EpParentProduct> | null>(
        "getParentProducts",
        { productIds: ids },
        null
      )) ?? {}
    );
  }

  if (!isUsableAuth(auth)) return {};
  const client = buildEpClient(auth);

  const batches = await Promise.all(
    batchProductIds(ids).map(async (batchIds) => {
      try {
        const response = await getByContextAllProducts({
          client,
          query: {
            filter: `in(id,${batchIds.join(",")})`,
            include: ["main_image"],
            "page[limit]": batchIds.length,
          } as any,
        });
        return response.data?.data ?? [];
      } catch {
        return [];
      }
    })
  );

  const parents: Record<string, EpParentProduct> = {};
  const parentIds: string[] = [];
  for (const product of batches.flat() as any[]) {
    if (!product?.id) continue;
    const isParent = Boolean(
      (product.relationships?.children?.data ?? []).length > 0 ||
        product.attributes?.base_product === true
    );
    parents[product.id] = {
      id: product.id,
      isParent,
      children: [],
      variations: readVariations(product),
      variationMatrix: product.meta?.variation_matrix,
    };
    if (isParent) parentIds.push(product.id);
  }

  for (const productId of ids) {
    if (parents[productId]) continue;
    parents[productId] = {
      id: productId,
      isParent: false,
      children: [],
      variations: [],
      error: `Product ${productId} not found`,
    };
  }

  const childResults = await Promise.all(
    parentIds.map(async (productId) => {
      try {
        const response = await getByContextChildProducts({
          client,
          path: { product_id: productId },
          query: { include: ["main_image"] } as any,
        });
        const children: EpChildProduct[] = (response.data?.data ?? []).map(
          (child: any) => ({
            id: child.id ?? "",
            name: child.attributes?.name,
            sku: child.attributes?.sku,
            price: child.meta?.display_price?.without_tax?.formatted,
            attributes: child.attributes,
            excluded: isExcluded(child),
          })
        );
        return { productId, children, error: undefined as string | undefined };
      } catch (err) {
        return {
          productId,
          children: [] as EpChildProduct[],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  for (const { productId, children, error } of childResults) {
    parents[productId] = { ...parents[productId], children, error };
  }

  return parents;
}
