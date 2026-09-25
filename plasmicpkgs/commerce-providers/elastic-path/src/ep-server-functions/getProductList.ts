import type { Product } from "../types/product";
import { isUsableAuth } from "./ep-client";
import { epGetProductPage } from "./getProductPage";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";
import { getCurrentEpSession } from "./session-context";
import type { EpServerAuth } from "./types";

export interface EpGetProductListInput {
  /** Page size. Defaults to 25 (EP default). */
  limit?: number;
  /** Search query applied against product name. */
  search?: string;
  /** Filter by EP hierarchy (category) ID. */
  categoryId?: string | number;
  /** SSR-only explicit auth. Never advertised; never bind in Studio. */
  auth?: EpServerAuth;
}

/**
 * The first page of products as a flat array, dropping Elastic Path's envelope.
 *
 * Kept for callers that never needed the total count. `epGetProductPage` is the
 * one implementation — everything about filtering and normalization lives
 * there. The browser transport is this function's own, so that a caller that
 * named `getProductList` reaches an operation of that name on the server.
 */
export async function epGetProductList(
  input: EpGetProductListInput = {}
): Promise<Product[]> {
  const auth = getCurrentEpSession() ?? input.auth;

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    const { limit, search, categoryId } = input;
    return (
      (await callEpProxy<Product[] | null>(
        "getProductList",
        { limit, search, categoryId },
        null
      )) ?? []
    );
  }

  const page = await epGetProductPage(input);
  return page.data;
}
