import type { Product } from "../types/product";
import { epGetProductPage } from "./getProductPage";
import type { EpServerAuth } from "./types";

export interface EpGetProductListInput {
  /** Page size. Defaults to 25 (EP default). */
  limit?: number;
  /** Search query applied against product name. */
  search?: string;
  /** Filter by EP hierarchy (category) ID. */
  categoryId?: string | number;
  /** Sort key understood by the shared `getSortVariables` helper. */
  sort?: string;
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

/**
 * The first page of products as a flat array, dropping Elastic Path's envelope.
 *
 * Kept for callers that never needed the total count. `epGetProductPage` is the
 * one implementation — everything about auth, proxying, filtering and
 * normalization lives there.
 */
export async function epGetProductList(
  input: EpGetProductListInput = {}
): Promise<Product[]> {
  const page = await epGetProductPage(input);
  return page.data;
}
