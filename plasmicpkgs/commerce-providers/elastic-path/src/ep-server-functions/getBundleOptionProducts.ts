import { normalizeProductFromList } from "../utils/normalize";
import type { Product } from "../types/product";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { readProductsByIds } from "./product-batches";

export interface EpGetBundleOptionProductsInput {
  productIds: string[];
}

/**
 * The products a bundle offers as options, keyed by product id.
 *
 * Each is the package's own product shape, so an option renders from the same
 * fields as any other product — images joined from `included`, prices carrying
 * all four members.
 */
export async function epGetBundleOptionProducts({
  productIds,
}: EpGetBundleOptionProductsInput): Promise<Record<string, Product>> {
  const ids = (productIds ?? []).filter(Boolean);
  if (ids.length === 0) return {};
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<Record<string, Product> | null>(
        "getBundleOptionProducts",
        { productIds: ids },
        null
      )) ?? {}
    );
  }

  if (!isUsableAuth(auth)) return {};
  const client = buildEpClient(auth);
  const locale = auth.locale ?? "en-US";

  const products: Record<string, Product> = {};
  for (const batch of await readProductsByIds(client, ids)) {
    for (const row of batch.rows) {
      if (!row?.id) continue;
      products[row.id] = normalizeProductFromList(row, locale, batch.included);
    }
  }
  return products;
}
