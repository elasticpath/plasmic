import {
  getByContextProduct,
  getByContextChildProducts,
} from "@epcc-sdk/sdks-shopper";
import { normalizeProduct } from "../utils/normalize";
import type { Product } from "../types/product";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import type { EpServerAuth } from "./types";

export interface EpGetProductInput {
  id: string;
  /**
   * Optional explicit auth. SSR consumers normally rely on
   * `withEpSession` (AsyncLocalStorage) and never pass this; it stays
   * non-advertised so it never leaks into Studio bindings.
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

  // Browser path with no ALS/explicit auth — Studio canvas and the
  // data-query preview panel land here. Fetch via the consumer's proxy
  // route so the call uses the better-auth session cookie just like
  // SSR does, without exposing tokens to the browser bundle.
  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<Product | null>("getProduct", { id });
  }

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
