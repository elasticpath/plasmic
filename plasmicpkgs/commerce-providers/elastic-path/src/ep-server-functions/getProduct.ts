import {
  getByContextProduct,
  getByContextChildProducts,
} from "@epcc-sdk/sdks-shopper";
import { normalizeProduct } from "../utils/normalize";
import type { Product } from "../types/product";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import type { EpServerAuth } from "./types";

export interface EpGetProductInput {
  id: string;
  /**
   * Optional auth fallback for Studio canvas + the data-query
   * "Execute" panel, where no `withEpSession` scope is established.
   * SSR consumers should NOT set this in Studio bindings — `withEpSession`
   * in the catchall page handles it via AsyncLocalStorage and keeps the
   * SWR cache key minimal.
   */
  auth?: EpServerAuth;
}

interface ProductWithInitialVariant extends Product {
  __initialVariantId?: string;
}

export async function epGetProduct({
  id,
  auth: inputAuth,
}: EpGetProductInput): Promise<Product | null> {
  if (!id) return null;
  const auth = getCurrentEpSession() ?? inputAuth;
  if (!isUsableAuth(auth)) return null;

  const client = buildEpClient(auth);
  const response = await getByContextProduct({
    client,
    path: { product_id: id },
    query: { include: ["main_image", "files", "component_products"] },
  });

  if (!response.data?.data) return null;

  let productData = response.data;
  let initialVariantId: string | undefined;

  const isChildProduct =
    productData.data?.meta?.product_types?.includes("child");
  const parentRelationship = productData.data?.relationships as
    | { parent?: { data?: { id?: string } } }
    | undefined;
  const parentId = isChildProduct
    ? productData.data?.attributes?.base_product_id ||
      parentRelationship?.parent?.data?.id
    : null;

  if (isChildProduct && parentId) {
    initialVariantId = id;
    const parentResponse = await getByContextProduct({
      client,
      path: { product_id: parentId },
      query: { include: ["main_image", "files", "component_products"] },
    });
    if (parentResponse.data?.data) {
      productData = parentResponse.data;
    }
  }

  const hasVariations =
    productData.data?.meta?.variations &&
    productData.data.meta.variations.length > 0;
  const baseProductId = isChildProduct && parentId ? parentId : id;

  let childProducts = null;
  if (hasVariations) {
    try {
      const childProductsResponse = await getByContextChildProducts({
        client,
        path: { product_id: baseProductId },
        query: { include: ["main_image", "files"] },
      });
      childProducts = childProductsResponse.data;
    } catch {
      // Continue without child products if fetch fails.
    }
  }

  const product = normalizeProduct(
    productData,
    auth.locale ?? "en-US",
    childProducts || undefined
  );

  if (initialVariantId) {
    (product as ProductWithInitialVariant).__initialVariantId =
      initialVariantId;
  }

  return product;
}
