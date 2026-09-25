import { getByContextChildProducts } from "@epcc-sdk/sdks-shopper";
import { normalizeProduct } from "../utils/normalize";
import type { Product } from "../types/product";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { readProductsByIds } from "./product-batches";

export interface EpGetBaseProductsInput {
  productIds: string[];
}

/** A base product is one a shopper cannot buy — it carries the variations. */
function isBaseProduct(row: any): boolean {
  return Boolean(
    (row?.relationships?.children?.data ?? []).length > 0 ||
      row?.attributes?.base_product === true
  );
}

/**
 * The given products with their variations and child products, keyed by id.
 *
 * Two reads, as Elastic Path models it: the products themselves, then the
 * children of each base product among them. A product that turns out not to be
 * a base product comes back with an empty `childProducts`, so one call answers
 * both "is this a variation family?" and "what is in it?".
 *
 * A product the catalog does not return is omitted rather than reported as
 * childless — absent and purchasable-on-its-own are different answers, and a
 * caller that needs the distinction still has the ids it asked for.
 */
export async function epGetBaseProducts({
  productIds,
}: EpGetBaseProductsInput): Promise<Record<string, Product>> {
  const ids = (productIds ?? []).filter(Boolean);
  if (ids.length === 0) return {};
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return (
      (await callEpProxy<Record<string, Product> | null>(
        "getBaseProducts",
        { productIds: ids },
        null
      )) ?? {}
    );
  }

  if (!isUsableAuth(auth)) return {};
  const client = buildEpClient(auth);
  const locale = auth.locale ?? "en-US";

  const rows: { row: any; included: any }[] = [];
  for (const batch of await readProductsByIds(client, ids)) {
    for (const row of batch.rows) {
      if (row?.id) rows.push({ row, included: batch.included });
    }
  }

  const products: Record<string, Product> = {};
  await Promise.all(
    rows.map(async ({ row, included }) => {
      let childProducts;
      if (isBaseProduct(row)) {
        try {
          const response = await getByContextChildProducts({
            client,
            path: { product_id: row.id },
            query: { include: ["main_image", "files"] } as any,
          });
          childProducts = response.data;
        } catch {
          // A base product whose children are unreadable still renders as a
          // product; it just has nothing to select from.
        }
      }
      products[row.id] = normalizeProduct(
        { data: row, included },
        locale,
        childProducts as never
      );
    })
  );

  return products;
}
