import { getByContextAllRelatedProducts } from "@epcc-sdk/sdks-shopper";
import { normalizeProductFromList } from "../utils/normalize";
import type { Product } from "../types/product";
import type { EpServerAuth } from "./types";
import { buildEpClient, isUsableAuth } from "./ep-client";

export interface EpGetRelatedProductsInput {
  productId: string;
  /**
   * EP custom relationship slug, e.g. "CRP_related_products",
   * "CRP_upsell", "CRP_accessories".
   */
  relationshipSlug: string;
  limit?: number;
  auth: EpServerAuth;
}

export async function epGetRelatedProducts({
  productId,
  relationshipSlug,
  limit,
  auth,
}: EpGetRelatedProductsInput): Promise<Product[]> {
  if (!productId || !relationshipSlug) return [];
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
    const data = response.data?.data;
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.map((p: any) =>
      normalizeProductFromList(p, response.data, auth.locale ?? "en-US")
    );
  } catch {
    return [];
  }
}
