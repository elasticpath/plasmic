import {
  getByContextAllProducts,
  getByContextProduct,
} from "@epcc-sdk/sdks-shopper";
import type { Client, ProductData } from "@epcc-sdk/sdks-shopper";
import { createLogger } from "../utils/logger";

const log = createLogger("productReference");

export const PRODUCT_INCLUDES: Array<
  "main_image" | "files" | "component_products"
> = ["main_image", "files", "component_products"];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Elastic Path's legacy filter syntax has no quoting, so anything outside this
// set reaches the filter parser as syntax and comes back as a 400.
const SLUG_SAFE = /^[A-Za-z0-9_.-]+$/;

type Lookup = "id" | "slug";

/** A single-product read's shape, with the product it found. */
export type FoundProduct = ProductData & {
  data: NonNullable<ProductData["data"]> & { id: string };
};

function withProduct(read: ProductData | undefined): FoundProduct | null {
  return read?.data?.id ? (read as FoundProduct) : null;
}

/** A read that ran and failed, as opposed to one that found nothing. */
export class ProductReadError extends Error {
  constructor(lookup: Lookup, readonly status?: number) {
    super(`Elastic Path product read by ${lookup} failed (${status ?? "no status"})`);
    this.name = "ProductReadError";
  }
}

function lookupsFor(reference: string): Lookup[] {
  if (!SLUG_SAFE.test(reference)) return [];
  return UUID.test(reference) ? ["id", "slug"] : ["slug"];
}

interface SdkResult<T> {
  data?: T;
  error?: unknown;
  response?: { status?: number };
}

async function readById(
  client: Client,
  id: string
): Promise<FoundProduct | null> {
  const result = (await getByContextProduct({
    client,
    path: { product_id: id },
    query: { include: PRODUCT_INCLUDES },
  })) as SdkResult<ProductData>;
  if (result.error) {
    if (result.response?.status === 404) return null;
    throw new ProductReadError("id", result.response?.status);
  }
  return withProduct(result.data);
}

async function readBySlug(
  client: Client,
  slug: string
): Promise<FoundProduct | null> {
  const result = (await getByContextAllProducts({
    client,
    query: {
      filter: `eq(slug,${slug})`,
      include: PRODUCT_INCLUDES,
      "page[limit]": 1,
    } as any,
  })) as SdkResult<{ data?: ProductData["data"][]; included?: ProductData["included"] }>;
  if (result.error) throw new ProductReadError("slug", result.response?.status);
  return withProduct({
    data: result.data?.data?.[0],
    included: result.data?.included,
  });
}

/**
 * Reads the product a product reference names — its slug, or its id when it
 * has none — returning the single-product read's shape so the rest of a loader
 * cannot tell which lookup found it.
 *
 * Resolves to `null` when the reference names no product, and rejects with
 * {@link ProductReadError} when a read could not run.
 */
export async function readProductByReference(
  client: Client,
  reference: string
): Promise<FoundProduct | null> {
  const trimmed = reference.trim();
  const lookups = lookupsFor(trimmed);

  for (const lookup of lookups) {
    const found =
      lookup === "id"
        ? await readById(client, trimmed)
        : await readBySlug(client, trimmed);
    if (found) return found;
  }

  log.warn("No product matches the reference", { reference, lookups });
  return null;
}
