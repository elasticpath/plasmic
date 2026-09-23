import { getByContextAllProducts } from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { batchProductIds } from "./product-batches";
import type { EpServerAuth } from "./types";

/** The display metadata a bundle option needs to render its choice. */
export interface EpBundleOptionProduct {
  id: string;
  name?: string;
  description?: string;
  /** The `main_image` file id, as the product's relationships carry it. */
  image?: string;
  price?: string;
  sku?: string;
}

export interface EpGetBundleOptionProductsInput {
  productIds: string[];
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

/**
 * Display metadata for a bundle's option products, keyed by product id.
 *
 * A batch that fails contributes nothing rather than failing the whole read —
 * a bundle with one unreachable option still renders its other options.
 */
export async function epGetBundleOptionProducts({
  productIds,
  auth: inputAuth,
}: EpGetBundleOptionProductsInput): Promise<
  Record<string, EpBundleOptionProduct>
> {
  const ids = (productIds ?? []).filter(Boolean);
  if (ids.length === 0) return {};
  const auth = getCurrentEpSession() ?? inputAuth;

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<Record<string, EpBundleOptionProduct> | null>(
        "getBundleOptionProducts",
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

  const products: Record<string, EpBundleOptionProduct> = {};
  for (const product of batches.flat() as any[]) {
    if (!product?.id) continue;
    products[product.id] = {
      id: product.id,
      name: product.attributes?.name,
      description: product.attributes?.description,
      image: product.relationships?.main_image?.data?.id,
      price: product.meta?.display_price?.without_tax?.formatted,
      sku: product.attributes?.sku,
    };
  }
  return products;
}
