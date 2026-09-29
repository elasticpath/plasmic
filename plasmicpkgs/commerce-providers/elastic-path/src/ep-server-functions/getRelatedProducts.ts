import { getByContextAllRelatedProducts } from "@epcc-sdk/sdks-shopper";
import { normalizeProductFromList } from "../utils/normalize";
import type { Product } from "../types/product";
import { createLogger } from "../utils/logger";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";

const log = createLogger("getRelatedProducts");

export interface EpGetRelatedProductsInput {
  productId: string;
  /**
   * EP custom relationship slug, e.g. "CRP_related_products",
   * "CRP_upsell", "CRP_accessories".
   */
  relationshipSlug: string;
  limit?: number;
}

export async function epGetRelatedProducts({
  productId,
  relationshipSlug,
  limit,
}: EpGetRelatedProductsInput): Promise<Product[]> {
  if (!productId || !relationshipSlug) return [];
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<Product[]>(
      "getRelatedProducts",
      { productId, relationshipSlug, limit },
      []
    );
  }

  if (!isUsableAuth(auth)) return [];
  const client = buildEpClient(auth);
  const query: Record<string, unknown> = {
    include: ["main_image", "files"],
  };
  if (limit) query["page[limit]"] = limit;

  try {
    const response = await getByContextAllRelatedProducts({
      client,
      path: {
        product_id: productId,
        custom_relationship_slug: relationshipSlug,
      },
      query: query as any,
    });
    if (response.error) {
      log.warn("Related products read failed (non-fatal)", {
        productId,
        relationshipSlug,
        status: response.response?.status,
      });
      return [];
    }
    const data = response.data?.data;
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.map((p: any) =>
      normalizeProductFromList(
        p,
        auth.locale ?? "en-US",
        response.data?.included
      )
    );
  } catch (err) {
    log.warn("Related products read failed (non-fatal)", {
      productId,
      relationshipSlug,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
