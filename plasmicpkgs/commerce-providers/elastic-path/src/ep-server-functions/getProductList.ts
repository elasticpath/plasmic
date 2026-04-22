import { getByContextAllProducts } from "@epcc-sdk/sdks-shopper";
import { normalizeProductFromList } from "../utils/normalize";
import { getSortVariables } from "../utils";
import type { Product } from "../types/product";
import type { EpServerAuth } from "./types";
import { buildEpClient, isUsableAuth } from "./ep-client";

export interface EpGetProductListInput {
  /** Page size. Defaults to 25 (EP default). */
  limit?: number;
  /** Search query applied against product name. */
  search?: string;
  /** Filter by EP hierarchy (category) ID. */
  categoryId?: string | number;
  /** Sort key understood by the shared `getSortVariables` helper. */
  sort?: string;
  auth: EpServerAuth;
}

export async function epGetProductList({
  limit,
  search,
  categoryId,
  sort,
  auth,
}: EpGetProductListInput): Promise<Product[]> {
  if (!isUsableAuth(auth)) return [];
  const client = buildEpClient(auth);
  const query: Record<string, unknown> = {};
  if (limit) query["page[limit]"] = limit;
  if (search) query["filter"] = `eq(name,${search})`;
  if (categoryId) {
    query["filter"] = query["filter"]
      ? `${query["filter"]},category.id=${categoryId}`
      : `category.id=${categoryId}`;
  }
  if (sort) {
    const sortVariable = getSortVariables(sort);
    if (sortVariable) query["sort"] = sortVariable;
  }
  query["include"] = ["main_image", "files", "component_products"];

  try {
    const response = await getByContextAllProducts({
      client,
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
