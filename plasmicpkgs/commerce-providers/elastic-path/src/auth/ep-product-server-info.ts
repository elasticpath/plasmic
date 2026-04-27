/**
 * Server-side data fetching for EPProductProvider.
 *
 * Extracted from the component registration so it can be unit-tested
 * without importing @plasmicapp/host.
 */

export async function fetchProductForServer(
  productId: string,
  serverToken: string,
  host: string
): Promise<any> {
  const url = `${host}/catalog/products/${productId}?include=main_image,files,component_products`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${serverToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`EP product fetch failed (${response.status}): ${text}`);
  }

  return response.json();
}

export function epProductGetServerInfo(
  props: Record<string, any>,
  ops: any
): any {
  const serverToken = ops.readContext("ep-server-token");
  const host = ops.readContext("ep-host") ?? "https://useast.api.elasticpath.com";
  const productId = props.productId;

  if (!serverToken || !productId) return {};

  const product = ops.fetchData(
    ["ep-product", productId],
    () => fetchProductForServer(productId, serverToken, host)
  );

  return {
    providedData: [{ name: "epProduct", data: product }],
  };
}
