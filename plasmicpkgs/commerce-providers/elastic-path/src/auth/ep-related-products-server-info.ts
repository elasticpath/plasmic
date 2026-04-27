/**
 * Server-side data fetching for EPRelatedProductsProvider.
 *
 * Fetches related products from EP catalog API during prepass.
 * Uses the same catalog endpoint with a limit parameter.
 */

export async function fetchRelatedProductsForServer(
  productId: string,
  serverToken: string,
  host: string,
  maxProducts: number = 4
): Promise<any> {
  const params = new URLSearchParams({
    "include": "main_image",
    "page[limit]": String(maxProducts),
  });

  const url = `${host}/catalog/products?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${serverToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`EP related products fetch failed (${response.status}): ${text}`);
  }

  return response.json();
}

export function epRelatedProductsGetServerInfo(
  props: Record<string, any>,
  ops: any
): any {
  const serverToken = ops.readContext("ep-server-token");
  const host = ops.readContext("ep-host") ?? "https://useast.api.elasticpath.com";
  const productId = props.productId;

  if (!serverToken || !productId) return {};

  const maxProducts = props.maxProducts ?? 4;

  const data = ops.fetchData(
    ["ep-related-products", productId, maxProducts],
    () => fetchRelatedProductsForServer(productId, serverToken, host, maxProducts)
  );

  return {
    providedData: [{ name: "epRelatedProducts", data }],
  };
}
