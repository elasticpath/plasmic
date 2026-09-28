import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import {
  getByContextChildProducts,
  getByContextProduct,
} from "@epcc-sdk/sdks-shopper";
import type { Client, ProductData } from "@epcc-sdk/sdks-shopper";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { normalizeProduct } from "../utils";
import { handleAPIError } from "../utils/errorHandling";
import { createLogger } from "../utils/logger";
import type { Product } from "../types/product";
import {
  PRODUCT_INCLUDES,
  readProductByReference,
} from "./product-reference";

/**
 * Extends the normalized Product type with the initial variant ID.
 * Attached by the fetcher when a child product URL is visited so the
 * variation picker can pre-select the correct variant.
 */
interface ProductWithInitialVariant extends Product {
  __initialVariantId?: string;
}

const log = createLogger("useProduct");

export type GetProductInput = {
  id?: string;
};

/** Rejects when the read fails, so SWR reports it as an error, not as `null`. */
export async function fetchProduct(
  client: Client,
  locale: string,
  reference: string
): Promise<Product | null> {
  try {
    const found = await readProductByReference(client, reference);
    if (!found) {
      return null;
    }

    let productData: ProductData = found;
    const id = found.data.id;
    let childProducts = null;
    let initialVariantId: string | undefined;

    // If this is a child product (variant), fetch the parent to get variation metadata
    const isChildProduct =
      productData.data?.meta?.product_types?.includes("child");
    // base_product_id is on ProductAttributes; parent relationship provides a fallback
    const parentRelationship = productData.data?.relationships as
      | { parent?: { data?: { id?: string } } }
      | undefined;
    const parentId = isChildProduct
      ? productData.data?.attributes?.base_product_id ||
        parentRelationship?.parent?.data?.id
      : null;

    if (isChildProduct && parentId) {
      log.debug("Child product detected, fetching parent", {
        childId: id,
        parentId,
      } as Record<string, unknown>);
      initialVariantId = id;

      const parentResponse = await getByContextProduct({
        client,
        path: { product_id: parentId },
        query: { include: PRODUCT_INCLUDES },
      });

      if (parentResponse.data?.data) {
        productData = parentResponse.data;
      }
    }

    // Check if this is a parent product with variations
    const hasVariations =
      productData.data?.meta?.variations &&
      productData.data.meta.variations.length > 0;
    const baseProductId = isChildProduct && parentId ? parentId : id;

    if (hasVariations) {
      try {
        const childProductsResponse = await getByContextChildProducts({
          client,
          path: { product_id: baseProductId },
          query: { include: ["main_image", "files"] },
        });

        childProducts = childProductsResponse.data;
      } catch (error) {
        // Continue without child products if fetch fails
      }
    }

    const product = normalizeProduct(
      productData,
      locale,
      childProducts || undefined
    );

    // Attach the originally-requested child ID so the variation picker
    // can pre-select the correct variant
    if (initialVariantId) {
      (product as ProductWithInitialVariant).__initialVariantId =
        initialVariantId;
    }

    return product;
  } catch (error) {
    const standardError = handleAPIError(error, "fetching product");
    log.error("Error fetching product", {
      error: standardError.message,
    } as Record<string, unknown>);
    throw error;
  }
}

export default function useProduct(input: GetProductInput = {}) {
  const commerce = useEpCommerce();
  const client = commerce?.client;
  const locale = commerce?.locale ?? "en-US";
  const { id } = input;

  const key = client && id ? ["ep-product", id] : null;
  const query = useMutablePlasmicQueryData<Product | null, Error>(
    key,
    () => fetchProduct(client!, locale, id!),
    { revalidateOnFocus: false }
  );
  // A null key reads as loading forever; no read is running.
  return key ? query : { ...query, isLoading: false };
}
